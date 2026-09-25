// Gateway orchestration: idempotent invocations, encrypted request/results,
// sync chat/image/video calls and async video jobs. All DB access runs inside
// a user-context transaction (RLS GUC). Upstream behavior is injectable (deps)
// so tests exercise real idempotency without network.
// Design source: self-hosted-cloud-models-design.md §5.3, §5.5, §9.
import crypto from 'node:crypto';
import { withUserContext } from '../db.js';
import { sealSecret, openSecret, requestHash } from './crypto.js';
import { PolicyError } from './policy.js';
import { uploadMedia, getMediaRecord } from './media.js';
import { createNotification } from '../notifications.js';

export class IdempotencyConflictError extends PolicyError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'idempotency conflict: different request for same key', 409);
  }
}

// ---------- invocation storage (client-scoped for RLS) ----------

const findInvocation = async (client, { userId, operation, idempotencyKey }) => {
  const { rows } = await client.query(
    `SELECT * FROM model_invocations
     WHERE user_id = $1 AND operation = $2 AND idempotency_key = $3`,
    [userId, operation, idempotencyKey]
  );
  return rows[0] ?? null;
};

const insertInvocation = async (client, { userId, model, operation, idempotencyKey, hash, payload }) => {
  const sealed = sealSecret(JSON.stringify(payload), {
    ownerId: userId,
    recordId: 'request',
    field: operation,
  });
  const { rows } = await client.query(
    `INSERT INTO model_invocations
       (id, user_id, model_id, model_id_snapshot, operation, idempotency_key, request_hash,
        request_payload_ciphertext, request_payload_iv, request_payload_tag, request_payload_key_id,
        status)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, $5, $6, $7, $8, $9, 'created')
     ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      userId,
      model?.id ?? null,
      operation,
      idempotencyKey,
      hash,
      sealed.ciphertext,
      sealed.iv,
      sealed.tag,
      sealed.keyId,
    ]
  );
  return rows[0]?.id ?? null;
};

const openInvocationPayload = (inv) => {
  const raw = openSecret(
    {
      ciphertext: inv.request_payload_ciphertext,
      iv: inv.request_payload_iv,
      tag: inv.request_payload_tag,
      keyId: inv.request_payload_key_id,
    },
    { ownerId: inv.user_id, recordId: 'request', field: inv.operation, keyId: inv.request_payload_key_id }
  );
  return JSON.parse(raw);
};

const storeTextResult = async (client, { invocationId, text }) => {
  const sealed = sealSecret(text, { ownerId: invocationId, recordId: 'invocation', field: 'result_text' });
  await client.query(
    `UPDATE model_invocations
     SET result_text_ciphertext = $2, result_text_iv = $3, result_text_tag = $4, result_text_key_id = $5,
         status = 'succeeded', updated_at = NOW()
     WHERE id = $1`,
    [invocationId, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId]
  );
};

const storeMediaResult = async (client, { invocationId, record }) => {
  await client.query(
    `UPDATE model_invocations
     SET result_media_asset_id = $2, status = 'succeeded', updated_at = NOW()
     WHERE id = $1`,
    [invocationId, record.id]
  );
  await client.query('UPDATE media_assets SET ref_count = ref_count + 1 WHERE id = $1', [record.id]);
};

export { storeTextResult, storeMediaResult };

const loadInvocationResult = async (client, inv) => {
  if (inv.result_text_ciphertext) {
    const text = openSecret(
      { ciphertext: inv.result_text_ciphertext, iv: inv.result_text_iv, tag: inv.result_text_tag, keyId: inv.result_text_key_id },
      { ownerId: inv.id, recordId: 'invocation', field: 'result_text', keyId: inv.result_text_key_id }
    );
    return { schemaVersion: 1, kind: 'chat', content: text, responseFormat: 'text' };
  }
  if (inv.result_media_asset_id) {
    const record = await getMediaRecord(inv.user_id, inv.result_media_asset_id);
    if (record) {
      return { schemaVersion: 1, kind: 'asset', assetId: record.id, contentType: record.content_type, sizeBytes: Number(record.size_bytes) };
    }
  }
  return { schemaVersion: 1, kind: 'job', jobId: inv.id, status: inv.status };
};

// ---------- sync invocation ----------

export const invokeSync = async ({ userId, isAdmin, model, provider, operation, idempotencyKey, payload, buildRequest, parseResponse, uploadResult, deps }) => {
  const canonical = JSON.stringify({ operation, payload });
  const hash = requestHash(canonical);

  const existing = await withUserContext({ userId, isAdmin }, async (client) => {
    return findInvocation(client, { userId, operation, idempotencyKey });
  });
  if (existing) {
    if (existing.request_hash !== hash) throw new IdempotencyConflictError();
    return withUserContext({ userId, isAdmin }, (client) => loadInvocationResult(client, existing));
  }

  const invocationId = await withUserContext({ userId, isAdmin }, async (client) => {
    const id = await insertInvocation(client, { userId, model, operation, idempotencyKey, hash, payload });
    if (!id) {
      const other = await findInvocation(client, { userId, operation, idempotencyKey });
      if (other && other.request_hash !== hash) throw new IdempotencyConflictError();
      return other?.id ?? null;
    }
    await client.query(`UPDATE model_invocations SET status = 'submitting', updated_at = NOW() WHERE id = $1`, [id]);
    return id;
  });
  if (!invocationId) throw new PolicyError('INTERNAL', 'failed to create invocation', 500);

  let upstreamResult;
  try {
    upstreamResult = await deps.fetchUpstream({ provider, model, operation, payload, buildRequest, parseResponse });
  } catch (err) {
    await withUserContext({ userId, isAdmin }, (client) =>
      client.query(
        `UPDATE model_invocations SET status = 'failed', error_code = 'UPSTREAM_ERROR', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [invocationId, String(err.message).slice(0, 500)]
      )
    );
    throw err;
  }

  return withUserContext({ userId, isAdmin }, async (client) => {
    const result = await uploadResult({ client, userId, invocationId, model, upstreamResult });
    return result;
  });
};

// ---------- async video jobs ----------

export const createAsyncJob = async ({ userId, isAdmin, model, provider, idempotencyKey, payload, buildRequest, deps }) => {
  const operation = 'video';
  const canonical = JSON.stringify({ operation, payload });
  const hash = requestHash(canonical);

  const existing = await withUserContext({ userId, isAdmin }, (client) =>
    findInvocation(client, { userId, operation, idempotencyKey })
  );
  if (existing) {
    if (existing.request_hash !== hash) throw new IdempotencyConflictError();
    const job = await withUserContext({ userId, isAdmin }, (client) => findJobByInvocation(client, existing.id));
    if (job) return { schemaVersion: 1, kind: 'job', jobId: job.id, status: job.status };
    return { schemaVersion: 1, kind: 'job', jobId: existing.id, status: existing.status };
  }

  const invocationId = await withUserContext({ userId, isAdmin }, async (client) => {
    const id = await insertInvocation(client, { userId, model, operation, idempotencyKey, hash, payload });
    if (!id) {
      const other = await findInvocation(client, { userId, operation, idempotencyKey });
      if (other && other.request_hash !== hash) throw new IdempotencyConflictError();
      return other?.id ?? null;
    }
    const credentialVersionId = provider.credential?.versionId ?? null;
    await client.query(
      `INSERT INTO model_jobs (id, invocation_id, user_id, model_snapshot, credential_version_id, status, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, 'created', NOW() + interval '24 hours')`,
      [
        id,
        userId,
        JSON.stringify({
          protocolPreset: model.protocol_preset,
          providerId: provider.id,
          modelId: model.id,
          apiModel: model.api_model,
          endpointPath: model.endpoint_path,
          baseUrl: provider.base_url,
          credentialVersionId,
        }),
        credentialVersionId,
      ]
    );
    return id;
  });
  if (!invocationId) throw new PolicyError('INTERNAL', 'failed to create job', 500);

  const job = await withUserContext({ userId, isAdmin }, (client) => findJobByInvocation(client, invocationId));
  await withUserContext({ userId, isAdmin }, (client) =>
    client.query(`UPDATE model_jobs SET status = 'submitting', attempt_count = attempt_count + 1, updated_at = NOW() WHERE id = $1`, [job.id])
  );

  let taskId;
  try {
    const upstream = await deps.fetchUpstream({ provider, model, operation, payload, buildRequest, parseResponse: deps.parseCreateResponse });
    taskId = upstream.taskId;
  } catch {
    // Unknown outcome: never auto-resubmit.
    await withUserContext({ userId, isAdmin }, (client) =>
      client.query(
        `UPDATE model_jobs SET status = 'submission_uncertain', updated_at = NOW() WHERE id = $1`,
        [job.id]
      )
    );
    return { schemaVersion: 1, kind: 'job', jobId: job.id, status: 'submission_uncertain' };
  }

  await withUserContext({ userId, isAdmin }, async (client) => {
    await client.query(
      `UPDATE model_jobs SET status = 'queued', upstream_task_id = $2, next_poll_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.id, taskId]
    );
    await client.query(`UPDATE model_invocations SET status = 'submitting', updated_at = NOW() WHERE id = $1`, [invocationId]);
  });
  return { schemaVersion: 1, kind: 'job', jobId: job.id, status: 'queued' };
};

const findJobByInvocation = async (client, invocationId) => {
  const { rows } = await client.query('SELECT * FROM model_jobs WHERE invocation_id = $1', [invocationId]);
  return rows[0] ?? null;
};

export const findJob = async ({ userId, isAdmin, jobId }) => {
  return withUserContext({ userId, isAdmin }, async (client) => {
    const { rows } = await client.query(
      `SELECT j.*, i.model_id_snapshot, i.operation, i.result_media_asset_id
       FROM model_jobs j JOIN model_invocations i ON i.id = j.invocation_id
       WHERE j.id = $1 AND j.user_id = $2`,
      [jobId, userId]
    );
    return rows[0] ?? null;
  });
};

// Poll one queued/polling job: query upstream status and move to terminal.
export const pollJob = async ({ userId, isAdmin, job, deps }) => {
  if (job.status === 'cancel_requested') {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(`UPDATE model_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [job.id]);
      return { ...job, status: 'cancelled' };
    });
  }
  if (job.expires_at && new Date(job.expires_at).getTime() < Date.now()) {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(`UPDATE model_jobs SET status = 'expired', updated_at = NOW() WHERE id = $1`, [job.id]);
      return { ...job, status: 'expired' };
    });
  }
  if (!job.upstream_task_id) {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(`UPDATE model_jobs SET status = 'submission_uncertain', updated_at = NOW() WHERE id = $1`, [job.id]);
      return { ...job, status: 'submission_uncertain' };
    });
  }

  let upstream;
  try {
    upstream = await deps.fetchJobStatus({ job, taskId: job.upstream_task_id });
  } catch {
    const attempts = job.attempt_count + 1;
    const backoff = Math.min(5000 * 2 ** Math.min(attempts, 6), 300000);
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(
        `UPDATE model_jobs SET attempt_count = $2, next_poll_at = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW() WHERE id = $1`,
        [job.id, attempts, backoff]
      );
      return { ...job, attempt_count: attempts };
    });
  }

  if (upstream.state === 'waiting') {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(
        `UPDATE model_jobs SET status = 'polling', attempt_count = attempt_count + 1, next_poll_at = NOW() + interval '5 seconds', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      return { ...job, status: 'polling' };
    });
  }
  if (upstream.state === 'failure') {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(
        `UPDATE model_jobs SET status = 'failed', error_code = 'UPSTREAM_FAILED', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [job.id, String(upstream.error || 'upstream failed').slice(0, 500)]
      );
      await client.query(`UPDATE model_invocations SET status = 'failed', updated_at = NOW() WHERE id = $1`, [job.invocation_id]);
      await createNotification(client, { userId: job.user_id, kind: 'job_failed', payload: { jobId: job.id } });
      return { ...job, status: 'failed' };
    });
  }

  // success: download content through the same hardened fetch path.
  try {
    const media = await deps.downloadJobResult({ job, resourceId: upstream.resourceId });
    const record = await uploadMedia({
      userId: job.user_id,
      buffer: media.buffer,
      contentType: media.contentType,
      checksumSha256: crypto.createHash('sha256').update(media.buffer).digest('hex'),
    });
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(
        `UPDATE model_jobs SET status = 'succeeded', result_origin = 'downloaded', result_object_key = $2,
                result_content_type = $3, result_size_bytes = $4, updated_at = NOW()
         WHERE id = $1`,
        [job.id, record.object_key, record.content_type, record.size_bytes]
      );
      await client.query(
        `UPDATE model_invocations SET result_media_asset_id = $2, status = 'succeeded', updated_at = NOW() WHERE id = $1`,
        [job.invocation_id, record.id]
      );
      await client.query('UPDATE media_assets SET ref_count = ref_count + 1 WHERE id = $1', [record.id]);
      await createNotification(client, { userId: job.user_id, kind: 'job_done', payload: { jobId: job.id } });
      return { ...job, status: 'succeeded' };
    });
  } catch (err) {
    return withUserContext({ userId, isAdmin }, async (client) => {
      await client.query(
        `UPDATE model_jobs SET status = 'failed', error_code = 'DOWNLOAD_FAILED', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [job.id, String(err.message).slice(0, 500)]
      );
      return { ...job, status: 'failed' };
    });
  }
};

export const cancelJob = async ({ userId, isAdmin, jobId }) => {
  const job = await findJob({ userId, isAdmin, jobId });
  if (!job) return null;
  if (['succeeded', 'failed', 'cancelled', 'expired'].includes(job.status)) return job;
  return withUserContext({ userId, isAdmin }, async (client) => {
    await client.query(
      `UPDATE model_jobs SET status = 'cancel_requested', cancel_requested_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [jobId]
    );
    await client.query(`UPDATE model_invocations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [job.invocation_id]);
    return { ...job, status: 'cancel_requested' };
  });
};

// Authenticated model gateway routes. Client sends modelId + operation +
// business params + Idempotency-Key; the server resolves the provider URL and
// injects credentials. No targetUrl or upstream headers ever come from the
// browser. Design source: self-hosted-cloud-models-design.md §9.
import { Router } from 'express';
import crypto from 'node:crypto';
import { withUserContext } from '../db.js';
import { requireUser, csrfProtection, hashIp, wrap } from '../auth/middleware.js';
import { recordAudit } from '../auth/audit.js';
import { assertModelAccess, assertPrompt, assertAspectRatio, assertDuration, assertReferenceCount, PolicyError } from '../model-gateway/policy.js';
import { invokeSync, createAsyncJob, findJob, pollJob, cancelJob, storeTextResult, storeMediaResult, IdempotencyConflictError } from '../model-gateway/gateway.js';
import {
  buildChatRequest, parseChatResponse,
  buildImageRequest, parseImageResponse,
  buildVideoCreateRequest, parseVideoCreateResponse, parseVideoSyncResponse,
  classifyVideoStatus, extractVideoResult, extractVideoError,
} from '../model-gateway/presets.js';
import { ensureMediaRef, getMediaContent, deleteMedia, toMediaRef } from '../model-gateway/media.js';
import { fetchUpstream } from '../model-gateway/upstream.js';
import { sealSecret, openSecret } from '../model-gateway/crypto.js';

export const modelGatewayRouter = Router();

modelGatewayRouter.use(wrap(requireUser));

// ---------- Provider / Model CRUD (private user-scoped, shared admin-only) ----------

const validateBaseUrl = (baseUrl) => {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PolicyError('INVALID_PARAMS', 'invalid baseUrl', 422);
  }
  const localOk = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localOk)) {
    throw new PolicyError('INVALID_PARAMS', 'baseUrl must be https (or localhost http in dev)', 422);
  }
  return url.href.replace(/\/+$/, '');
};

const validateAuth = ({ authType, authHeaderName }) => {
  if (!['none', 'bearer', 'api-key-header'].includes(authType)) {
    throw new PolicyError('INVALID_PARAMS', 'invalid authType', 422);
  }
  if (authType === 'api-key-header' && (!authHeaderName || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(authHeaderName))) {
    throw new PolicyError('INVALID_PARAMS', 'invalid authHeaderName', 422);
  }
  if (authType === 'bearer') {
    // bearer uses Authorization header server-side; no custom name needed.
  }
};

const requireVipOrThrow = async (userId) => {
  const { canUseCapability } = await import('../auth/entitlements.js');
  const ok = await canUseCapability({ userId, accessLevel: 'vip' });
  if (!ok) throw new PolicyError('VIP_REQUIRED', 'vip entitlement required for private providers', 403);
};

modelGatewayRouter.post(
  '/providers',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    try {
      const { name, baseUrl, authType = 'none', authHeaderName, scope = 'private' } = req.body || {};
      if (!name || !baseUrl) throw new PolicyError('INVALID_PARAMS', 'name and baseUrl are required', 422);
      if (scope !== 'private' && scope !== 'shared') throw new PolicyError('INVALID_PARAMS', 'invalid scope', 422);
      validateBaseUrl(baseUrl);
      validateAuth({ authType, authHeaderName });
      if (scope === 'shared' && req.user.role !== 'admin') {
        throw new PolicyError('ADMIN_ONLY', 'shared providers require admin', 403);
      }
      if (scope === 'private') await requireVipOrThrow(req.user.user_id);
      const isAdmin = req.user.role === 'admin';
      const providerId = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type, auth_header_name)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [scope === 'private' ? req.user.user_id : null, scope, name, baseUrl, authType, authHeaderName]
        );
        return rows[0].id;
      });
      await audit(req, { eventType: 'provider.create', result: 'success', metadata: { detail: scope } });
      res.json({ id: providerId });
    } catch (err) {
      if (err instanceof PolicyError) return res.status(err.status).json({ schemaVersion: 1, error: { code: err.code, message: err.message } });
      throw err;
    }
  })
);

modelGatewayRouter.get(
  '/providers',
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const providers = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
      const { rows } = await client.query(
        `SELECT id, scope, name, base_url, auth_type, auth_header_name, enabled, deleted_at,
                (active_credential_version_id IS NOT NULL) AS credential_configured
         FROM model_providers WHERE deleted_at IS NULL ORDER BY created_at`
      );
      return rows;
    });
    res.json({ providers });
  })
);

modelGatewayRouter.post(
  '/providers/:id/credential',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    try {
      const { secret } = req.body || {};
      if (typeof secret !== 'string' || secret.length === 0) {
        throw new PolicyError('INVALID_PARAMS', 'secret is required', 422);
      }
      const isAdmin = req.user.role === 'admin';
      await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
        const { rows } = await client.query(
          'SELECT id, owner_user_id, scope, auth_type FROM model_providers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [req.params.id]
        );
        const provider = rows[0];
        if (!provider) throw new PolicyError('NOT_FOUND', 'provider not found', 404);
        const isOwner = provider.scope === 'private' && provider.owner_user_id === req.user.user_id;
        const isAdminShared = provider.scope === 'shared' && req.user.role === 'admin';
        if (!isOwner && !isAdminShared) throw new PolicyError('FORBIDDEN', 'not your provider', 404);
        if (provider.auth_type === 'none') {
          throw new PolicyError('INVALID_PARAMS', 'auth none does not accept a credential', 422);
        }
        const sealed = sealSecret(secret, {
          // Deterministic AAD owner component: private providers bind to the
          // owner user; shared providers (ownerless) bind to the provider id.
          ownerId: provider.owner_user_id || provider.id,
          recordId: provider.id,
          field: 'credential',
        });
        const versionId = crypto.randomUUID();
        await client.query(
          `INSERT INTO model_credential_versions (id, provider_id, ciphertext, iv, tag, encryption_key_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [versionId, provider.id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId]
        );
        await client.query(
          `UPDATE model_providers SET active_credential_version_id = $2, updated_at = NOW() WHERE id = $1`,
          [provider.id, versionId]
        );
      });
      await audit(req, { eventType: 'provider.credential', result: 'success', metadata: { detail: 'set' } });
      res.json({ success: true, credentialConfigured: true });
    } catch (err) {
      if (err instanceof PolicyError) return res.status(err.status).json({ schemaVersion: 1, error: { code: err.code, message: err.message } });
      throw err;
    }
  })
);

modelGatewayRouter.delete(
  '/providers/:id',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const { rows } = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
      const r = await client.query(
        'SELECT id, owner_user_id, scope FROM model_providers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [req.params.id]
      );
      const provider = r.rows[0];
      if (!provider) return { rows: [] };
      const isOwner = provider.scope === 'private' && provider.owner_user_id === req.user.user_id;
      const isAdminShared = provider.scope === 'shared' && req.user.role === 'admin';
      if (!isOwner && !isAdminShared) return { rows: [] };
      await client.query('UPDATE model_providers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [provider.id]);
      return { rows: [provider] };
    });
    if (rows.length === 0) return res.status(404).json({ schemaVersion: 1, error: { code: 'NOT_FOUND', message: 'provider not found' } });
    await audit(req, { eventType: 'provider.delete', result: 'success' });
    res.json({ success: true });
  })
);

// Models: derived ownership from provider; shared models admin-only.

modelGatewayRouter.post(
  '/models',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    try {
      const { providerId, name, apiModel, capability, adapterKind, protocolPreset, endpointPath, baseUrlOverride, authOverrideType, accessLevel = 'verified' } = req.body || {};
      if (!providerId || !name || !apiModel || !capability || !adapterKind || !endpointPath) {
        throw new PolicyError('INVALID_PARAMS', 'missing required model fields', 422);
      }
      if (!['chat', 'image', 'video'].includes(capability)) throw new PolicyError('INVALID_PARAMS', 'invalid capability', 422);
      if (!['openai-chat', 'openai-image', 'openai-video-sync', 'openai-video-async'].includes(protocolPreset)) {
        throw new PolicyError('INVALID_PARAMS', 'invalid protocolPreset', 422);
      }
      if (authOverrideType && !['none', 'bearer', 'api-key-header'].includes(authOverrideType)) {
        throw new PolicyError('INVALID_PARAMS', 'invalid authOverrideType', 422);
      }
      const isAdmin = req.user.role === 'admin';
      const modelId = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
        const { rows: prov } = await client.query(
          'SELECT id, scope, owner_user_id FROM model_providers WHERE id = $1 AND deleted_at IS NULL',
          [providerId]
        );
        const provider = prov[0];
        if (!provider) throw new PolicyError('NOT_FOUND', 'provider not found', 404);
        const isOwner = provider.scope === 'private' && provider.owner_user_id === req.user.user_id;
        const isAdminShared = provider.scope === 'shared' && req.user.role === 'admin';
        if (!isOwner && !isAdminShared) throw new PolicyError('FORBIDDEN', 'not your provider', 404);
        if (provider.scope === 'shared' && req.user.role !== 'admin') {
          throw new PolicyError('ADMIN_ONLY', 'models under a shared provider require admin', 403);
        }
        if (provider.scope === 'private' && accessLevel !== 'verified') {
          // Private models ignore access_level; force the safe default.
          void accessLevel;
        }
        const { rows } = await client.query(
          `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset,
             endpoint_path, base_url_override, auth_override_type, access_level)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [providerId, name, apiModel, capability, adapterKind, protocolPreset, endpointPath, baseUrlOverride || null, authOverrideType || null, provider.scope === 'private' ? 'verified' : accessLevel]
        );
        return rows[0].id;
      });
      await audit(req, { eventType: 'model.create', result: 'success' });
      res.json({ id: modelId });
    } catch (err) {
      if (err instanceof PolicyError) return res.status(err.status).json({ schemaVersion: 1, error: { code: err.code, message: err.message } });
      throw err;
    }
  })
);

modelGatewayRouter.get(
  '/models',
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const models = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
      const { rows } = await client.query(
        `SELECT m.id, m.name, m.api_model, m.capability, m.adapter_kind, m.protocol_preset,
                m.endpoint_path, m.access_level, m.enabled, m.deleted_at,
                p.scope AS provider_scope, p.name AS provider_name
         FROM models m JOIN model_providers p ON p.id = m.provider_id
         WHERE m.deleted_at IS NULL ORDER BY m.created_at`
      );
      return rows;
    });
    res.json({ models });
  })
);

modelGatewayRouter.delete(
  '/models/:id',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const { rows } = await withUserContext({ userId: req.user.user_id, isAdmin }, async (client) => {
      const r = await client.query(
        `SELECT m.id, p.scope, p.owner_user_id FROM models m
         JOIN model_providers p ON p.id = m.provider_id
         WHERE m.id = $1 AND m.deleted_at IS NULL FOR UPDATE OF m`,
        [req.params.id]
      );
      const model = r.rows[0];
      if (!model) return { rows: [] };
      const isOwner = model.scope === 'private' && model.owner_user_id === req.user.user_id;
      const isAdminShared = model.scope === 'shared' && req.user.role === 'admin';
      if (!isOwner && !isAdminShared) return { rows: [] };
      await client.query('UPDATE models SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [model.id]);
      return { rows: [model] };
    });
    if (rows.length === 0) return res.status(404).json({ schemaVersion: 1, error: { code: 'NOT_FOUND', message: 'model not found' } });
    await audit(req, { eventType: 'model.delete', result: 'success' });
    res.json({ success: true });
  })
);

const audit = (req, { eventType, result, metadata = {} }) =>
  recordAudit({
    actorUserId: req.user.user_id,
    targetUserId: req.user.user_id,
    eventType,
    result,
    requestId: req.id,
    ipHash: hashIp(req.ip),
    metadata: { action: eventType, ...metadata },
  });

const requireIdempotencyKey = (req) => {
  const key = req.get('idempotency-key');
  if (!key || key.length > 128) {
    throw new PolicyError('INVALID_PARAMS', 'Idempotency-Key header is required', 422);
  }
  return key;
};

// Load model + provider inside the user RLS context; returns null when
// invisible/disabled (404 without existence leak).
const loadModel = async ({ userId, isAdmin, modelId }) => {
  return withUserContext({ userId, isAdmin }, async (client) => {
    const { rows } = await client.query(
      `SELECT m.id, m.name, m.api_model, m.capability, m.adapter_kind, m.protocol_preset,
              m.endpoint_path, m.base_url_override, m.auth_override_type, m.access_level,
              m.enabled, m.deleted_at,
              m.protocol_config, m.timeout_ms,
              p.id AS provider_id, p.scope AS provider_scope, p.owner_user_id AS provider_owner,
              p.base_url AS provider_base_url, p.auth_type, p.auth_header_name,
              p.timeout_ms AS provider_timeout, p.enabled AS provider_enabled, p.deleted_at AS provider_deleted,
              cv.id AS credential_version_id, cv.ciphertext, cv.iv, cv.tag, cv.encryption_key_id
       FROM models m JOIN model_providers p ON p.id = m.provider_id
       LEFT JOIN model_credential_versions cv ON cv.id = p.active_credential_version_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [modelId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      api_model: row.api_model,
      capability: row.capability,
      adapter_kind: row.adapter_kind,
      protocol_preset: row.protocol_preset,
      endpoint_path: row.endpoint_path,
      base_url_override: row.base_url_override,
      auth_override_type: row.auth_override_type,
      access_level: row.access_level,
      enabled: row.enabled,
      protocol_config: row.protocol_config,
      timeout_ms: row.timeout_ms,
      provider: {
        id: row.provider_id,
        scope: row.provider_scope,
        owner_user_id: row.provider_owner,
        base_url: row.provider_base_url,
        auth_type: row.auth_type,
        auth_header_name: row.auth_header_name,
        timeout_ms: row.provider_timeout,
        enabled: row.provider_enabled,
        deleted_at: row.provider_deleted,
        credential: row.credential_version_id
          ? {
              versionId: row.credential_version_id,
              ciphertext: row.ciphertext,
              iv: row.iv,
              tag: row.tag,
              keyId: row.encryption_key_id,
              // Must mirror the AAD owner used at seal time.
              ownerId: row.provider_owner || row.provider_id,
            }
          : null,
      },
    };
  });
};

const resolveUpstreamUrl = ({ model, provider, path }) => {
  const base = (model.base_url_override || provider.base_url || '').replace(/\/+$/, '');
  const endpoint = path || model.endpoint_path || '/';
  const url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  return new URL(url).href;
};

// Server-side upstream caller for self-hosted models (no client input).
// Credentials are decrypted server-side and injected as upstream auth headers;
// the secret never travels to the browser nor appears in invocation records.
export const buildUpstreamCaller = ({ model, provider, deps }) => {
  const urlFor = (path) => resolveUpstreamUrl({ model, provider, path });
  const buildHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const authType = model.auth_override_type || provider.auth_type;
    if (!authType || authType === 'none') return headers;
    const credential = provider.credential;
    // No credential configured: call proceeds unauthenticated and surfaces
    // the upstream 401 as UPSTREAM_ERROR, mirroring "configured but empty".
    if (!credential) return headers;
    const secret = openSecret(credential, {
      ownerId: credential.ownerId,
      recordId: provider.id,
      field: 'credential',
      keyId: credential.keyId,
    });
    if (authType === 'bearer') {
      headers['Authorization'] = `Bearer ${secret}`;
    } else {
      headers[provider.auth_header_name] = secret;
    }
    return headers;
  };
  return {
    call: async ({ path, method = 'POST', jsonBody, parseResponse }) => {
      const res = await (deps?.fetchUpstream || fetchUpstream)({
        url: urlFor(path),
        method,
        headers: buildHeaders(),
        body: jsonBody !== undefined ? Buffer.from(JSON.stringify(jsonBody)) : undefined,
        maxBodyBytes: 50 * 1024 * 1024,
        timeoutMs: model.timeout_ms || provider.timeout_ms || 30000,
      });
      if (res.status < 200 || res.status >= 300) {
        const text = res.body.toString('utf8').slice(0, 500);
        throw new Error(`upstream ${res.status}: ${text}`);
      }
      const ct = res.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        return parseResponse(JSON.parse(res.body.toString('utf8')), ct, res.body);
      }
      return parseResponse(null, ct, res.body);
    },
  };
};

// ---------- POST /api/model-invocations ----------

modelGatewayRouter.post(
  '/invocations',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    try {
      const { modelId, operation, ...params } = req.body || {};
      const idempotencyKey = requireIdempotencyKey(req);
      if (!modelId || !operation) throw new PolicyError('INVALID_PARAMS', 'modelId and operation are required', 422);

      const isAdmin = req.user.role === 'admin';
      const model = await loadModel({ userId: req.user.user_id, isAdmin, modelId });
      await assertModelAccess({ model, provider: model?.provider, userId: req.user.user_id, isAdmin });

      const caller = buildUpstreamCaller({ model, provider: model.provider });
      const preset = model.protocol_preset;

      if (operation === 'chat' && model.capability === 'chat') {
        assertPrompt(params.prompt);
        const payload = { prompt: params.prompt, systemPrompt: params.systemPrompt, responseFormat: params.responseFormat };
        const result = await invokeSync({
          userId: req.user.user_id, isAdmin, model, provider: model.provider,
          operation: 'chat', idempotencyKey, payload,
          buildRequest: ({ payload: p }) => buildChatRequest({
            apiModel: model.api_model, prompt: p.prompt, systemPrompt: p.systemPrompt,
            responseFormat: p.responseFormat, supportsJson: model.protocol_config?.supportsJsonResponseFormat,
          }),
          parseResponse: ({ body }) => parseChatResponse(body),
          uploadResult: async ({ client, invocationId, upstreamResult }) => {
            await storeTextResult(client, { invocationId, text: upstreamResult });
            return { schemaVersion: 1, kind: 'chat', content: upstreamResult, responseFormat: params.responseFormat || 'text' };
          },
          deps: { fetchUpstream: caller.call },
        });
        await audit(req, { eventType: 'model.invoke', result: 'success', metadata: { detail: operation } });
        return res.json(result);
      }

      if (operation === 'image' && model.capability === 'image') {
        assertPrompt(params.prompt);
        assertAspectRatio(params.aspectRatio);
        assertReferenceCount(params.referenceAssetIds, 16, 'referenceAssetIds');
        const payload = { prompt: params.prompt, aspectRatio: params.aspectRatio, referenceAssetIds: params.referenceAssetIds };
        const result = await invokeSync({
          userId: req.user.user_id, isAdmin, model, provider: model.provider,
          operation: 'image', idempotencyKey, payload,
          buildRequest: ({ payload: p }) => buildImageRequest({
            apiModel: model.api_model, prompt: p.prompt, size: sizeForAspect(p.aspectRatio),
            responseFormat: model.protocol_config?.responseFormat || 'b64_json',
          }),
          parseResponse: ({ body, contentType, rawBuffer }) => parseImageResponse(body, contentType, rawBuffer),
          uploadResult: async ({ client, userId, invocationId, upstreamResult }) => {
            const record = await storeSyncMedia({ userId, upstreamResult, deps: caller });
            await storeMediaResult(client, { invocationId, record });
            return { schemaVersion: 1, kind: 'asset', assetId: record.id, contentType: record.content_type, sizeBytes: Number(record.size_bytes) };
          },
          deps: { fetchUpstream: caller.call },
        });
        await audit(req, { eventType: 'model.invoke', result: 'success', metadata: { detail: operation } });
        return res.json(result);
      }

      if (operation === 'video' && model.capability === 'video') {
        assertPrompt(params.prompt);
        assertAspectRatio(params.aspectRatio);
        assertDuration(params.duration, model.protocol_config?.allowedDurations);
        assertReferenceCount([params.startAssetId, params.endAssetId].filter(Boolean), 2, 'frame refs');
        const payload = { prompt: params.prompt, aspectRatio: params.aspectRatio, duration: params.duration, startAssetId: params.startAssetId, endAssetId: params.endAssetId };
        const isAsync = model.protocol_preset === 'openai-video-async';
        const result = await createAsyncJob({
          userId: req.user.user_id, isAdmin, model, provider: model.provider,
          idempotencyKey, payload,
          buildRequest: ({ payload: p }) => buildVideoCreateRequest({
            apiModel: model.api_model, prompt: p.prompt, size: sizeForAspect(p.aspectRatio), duration: p.duration,
          }),
          deps: {
            fetchUpstream: async (callParams) => caller.call({
              path: model.protocol_config?.createEndpoint,
              jsonBody: callParams.buildRequest(callParams),
              parseResponse: ({ body }) => parseVideoCreateResponse(body),
            }),
            parseCreateResponse: ({ body }) => parseVideoCreateResponse(body),
          },
        });
        void isAsync;
        await audit(req, { eventType: 'model.invoke', result: 'success', metadata: { detail: operation } });
        return res.status(202).json(result);
      }

      throw new PolicyError('UNSUPPORTED_OPERATION', `unsupported operation ${operation} for ${model.capability} model`, 422);
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        await audit(req, { eventType: 'model.invoke', result: 'failure', metadata: { detail: 'idempotency conflict' } });
        return res.status(409).json({ schemaVersion: 1, error: { code: err.code, message: err.message } });
      }
      if (err instanceof PolicyError) {
        return res.status(err.status).json({ schemaVersion: 1, error: { code: err.code, message: err.message, retryable: false } });
      }
      console.error('[model-gateway] invoke error:', err);
      return res.status(502).json({ schemaVersion: 1, error: { code: 'UPSTREAM_ERROR', message: 'upstream call failed', retryable: true } });
    }
  })
);

const sizeForAspect = (aspectRatio) => {
  const map = { '16:9': '1280x720', '9:16': '720x1280', '1:1': '1024x1024' };
  return map[aspectRatio] || '1280x720';
};

// Store a sync media result (b64 or remote URL through hardened download).
const storeSyncMedia = async ({ userId, upstreamResult, deps }) => {
  if (upstreamResult instanceof Buffer) {
    const { uploadMedia } = await import('../model-gateway/media.js');
    return uploadMedia({ userId, buffer: upstreamResult, contentType: 'application/octet-stream', checksumSha256: '' });
  }
  if (upstreamResult.base64) {
    const { uploadMedia } = await import('../model-gateway/media.js');
    const buffer = Buffer.from(upstreamResult.base64, 'base64');
    return uploadMedia({ userId, buffer, contentType: 'application/octet-stream', checksumSha256: '' });
  }
  if (upstreamResult.remoteUrl) {
    // Controlled download through the same SSRF-hardened path.
    const res = await deps.downloadRemote({ url: upstreamResult.remoteUrl });
    const { uploadMedia } = await import('../model-gateway/media.js');
    return uploadMedia({
      userId,
      buffer: res.body,
      contentType: res.headers['content-type'] || 'application/octet-stream',
      checksumSha256: '',
    });
  }
  throw new Error('no media payload from upstream');
};

// ---------- jobs ----------

modelGatewayRouter.get(
  '/jobs/:jobId',
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const job = await findJob({ userId: req.user.user_id, isAdmin, jobId: req.params.jobId });
    if (!job) return res.status(404).json({ schemaVersion: 1, error: { code: 'NOT_FOUND', message: 'job not found' } });
    return res.json({
      schemaVersion: 1,
      jobId: job.id,
      status: job.status,
      attemptCount: job.attempt_count,
      resultAssetId: job.result_media_asset_id || undefined,
      errorMessage: job.error_message || undefined,
      createdAt: job.created_at,
    });
  })
);

modelGatewayRouter.post(
  '/jobs/:jobId/cancel',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const job = await cancelJob({ userId: req.user.user_id, isAdmin, jobId: req.params.jobId });
    if (!job) return res.status(404).json({ schemaVersion: 1, error: { code: 'NOT_FOUND', message: 'job not found' } });
    await audit(req, { eventType: 'model.job.cancel', result: 'success', metadata: { detail: job.status } });
    return res.json({ schemaVersion: 1, jobId: job.id, status: job.status });
  })
);

// ---------- media assets ----------

modelGatewayRouter.post(
  '/media-assets',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    try {
      const { dataUrl } = req.body || {};
      const ref = await ensureMediaRef({ userId: req.user.user_id, dataUrl });
      await audit(req, { eventType: 'media.upload', result: 'success' });
      res.json({ assetId: ref.id, contentType: ref.contentType, sizeBytes: ref.sizeBytes });
    } catch (err) {
      if (err instanceof PolicyError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

modelGatewayRouter.get(
  '/media-assets/:assetId/content',
  wrap(async (req, res) => {
    try {
      const { buffer, contentType, sizeBytes } = await getMediaContent(req.user.user_id, req.params.assetId);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', sizeBytes);
      res.send(buffer);
    } catch (err) {
      if (err instanceof PolicyError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

modelGatewayRouter.delete(
  '/media-assets/:assetId',
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const ok = await deleteMedia(req.user.user_id, req.params.assetId);
    if (!ok) return res.status(404).json({ error: 'media not found' });
    await audit(req, { eventType: 'media.delete', result: 'success' });
    res.json({ success: true });
  })
);

// Structured audit log. Metadata uses an allow-list of fields; never store
// passwords, tokens, model keys, prompts or response bodies.
import { pool } from '../db.js';

export const recordAudit = async ({
  actorUserId = null,
  targetUserId = null,
  eventType,
  result,
  requestId = null,
  ipHash = null,
  metadata = {},
}) => {
  const allowed = {};
  for (const key of ['action', 'target', 'detail', 'scope']) {
    if (metadata[key] !== undefined) allowed[key] = metadata[key];
  }
  await pool.query(
    `INSERT INTO audit_events
       (id, actor_user_id, target_user_id, event_type, result, request_id, ip_hash, metadata)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [actorUserId, targetUserId, eventType, result, requestId, ipHash, JSON.stringify(allowed)]
  );
};

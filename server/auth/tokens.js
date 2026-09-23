// Random token generation, SHA-256 hashing and single-use atomic consumption.
// Only hashes are stored; raw tokens never persist.
import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

// Atomically consume a one-time token for a purpose inside the caller's
// transaction. Returns { id, user_id } or null when invalid/used/expired.
export async function consumeToken(client, tokenHash, purpose) {
  const { rows } = await client.query(
    `UPDATE user_action_tokens
     SET consumed_at = NOW()
     WHERE token_hash = $1
       AND purpose = $2
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING id, user_id`,
    [tokenHash, purpose]
  );
  return rows[0] ?? null;
}

// Invalidate all unconsumed tokens of a purpose for a user (single transaction).
export async function invalidateTokens(client, userId, purpose) {
  await client.query(
    `UPDATE user_action_tokens SET consumed_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  );
}

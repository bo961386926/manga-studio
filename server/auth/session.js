// Server-side sessions. The browser only holds a high-entropy cookie; the
// database stores SHA-256 hashes. CSRF hash is bound to the session.
import { pool } from '../db.js';
import { hashToken, randomToken } from './tokens.js';

export const SESSION_COOKIE = 'ms_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CSRF_TTL_MS = 10 * 60 * 1000;

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MAX_AGE_MS,
});

// Create a session for a user inside the caller's transaction (client).
// Returns the raw token (to set on the browser) plus the csrf token.
export async function createSession(client, { userId, ipHash, userAgentSummary }) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const tokenHash = hashToken(token);
  const csrfHash = hashToken(csrf);
  const { rows: [user] } = await client.query(
    'SELECT session_version FROM users WHERE id = $1',
    [userId]
  );
  if (!user) throw new Error('user not found');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  const csrfExpiresAt = new Date(Date.now() + CSRF_TTL_MS);
  const { rows: [session] } = await client.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at,
        csrf_version, expires_at, ip_hash, user_agent_summary)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, tokenHash, user.session_version, csrfHash, csrfExpiresAt, 1, expiresAt, ipHash, userAgentSummary]
  );
  return { sessionId: session.id, token, csrf, expiresAt };
}

// Resolve a raw cookie token to an active session joined with the user.
// Returns null for unknown, expired, revoked or invalidated sessions.
export async function readSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.user_id, s.csrf_token_hash, s.csrf_expires_at,
            s.csrf_version, s.expires_at, s.session_version AS session_version,
            u.email, u.role, u.status, u.email_verified_at,
            u.session_version AS user_session_version
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  const row = rows[0];
  if (!row) return null;
  // Any password change / logout-everywhere bumps user.session_version.
  if (row.user_session_version !== row.session_version) return null;
  if (row.status !== 'active') return null;
  return row;
}

export async function revokeSession(client, sessionId) {
  await client.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);
}

export async function revokeAllSessions(client, userId, { exceptSessionId } = {}) {
  if (exceptSessionId) {
    await client.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2',
      [userId, exceptSessionId]
    );
  } else {
    await client.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1', [userId]);
  }
}

// Rotate the CSRF pair after login / password change / session rotation.
export async function rotateCsrf(client, sessionId) {
  const csrf = randomToken(32);
  const csrfExpiresAt = new Date(Date.now() + CSRF_TTL_MS);
  await client.query(
    `UPDATE sessions SET csrf_token_hash = $2, csrf_expires_at = $3, csrf_version = csrf_version + 1
     WHERE id = $1`,
    [sessionId, hashToken(csrf), csrfExpiresAt]
  );
  return csrf;
}

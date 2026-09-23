// Shared test helpers for server-side node:test suites.
import crypto from 'node:crypto';
import { pool, initDB } from '../db.js';
import { normalizeEmail } from '../auth/password.js';
import { openActionToken } from '../auth/outbox.js';
import { app } from '../index.js';

// Ensure legacy baseline tables and pending migrations exist (idempotent).
export const ensureMigrated = async () => {
  await initDB();
};

// Clear identity tables so tests are repeatable against a shared test DB.
export const resetIdentityTables = async () => {
  const { rows } = await pool.query('SELECT current_database() AS name');
  if (!rows[0]?.name?.endsWith('_test')) {
    throw new Error(`refusing to truncate non-test database: ${rows[0]?.name || 'unknown'}`);
  }
  await pool.query(
    'TRUNCATE users, sessions, user_action_tokens, email_outbox RESTART IDENTITY CASCADE'
  );
};

export const listTables = async () => {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  return rows.map((r) => r.tablename);
};

// Insert a minimal pending_verification user; returns the generated UUID.
export const insertUser = async ({ id, email }) => {
  const userId = id ?? crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'user', 'pending_verification')`,
    [userId, email, normalizeEmail(email), 'test-hash-placeholder']
  );
  return userId;
};

// Boot the Express app on an ephemeral port for HTTP-level tests.
export const startTestServer = async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, server };
};

export const findUser = async (email) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE email_normalized = $1', [
    normalizeEmail(email),
  ]);
  return rows[0] ?? null;
};

export const countOutbox = async (purpose) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM email_outbox WHERE purpose = $1',
    [purpose]
  );
  return rows[0].c;
};

// Decrypt the most recent queued action token for a user/purpose, exercising
// the full seal/open AEAD path used by the real outbox worker.
export const getActionToken = async (email, purpose) => {
  const { rows } = await pool.query(
    `SELECT o.id AS outbox_id, o.user_id, o.purpose, o.action_token_id,
            o.action_token_ciphertext, o.action_token_iv, o.action_token_tag, o.action_token_key_id
     FROM email_outbox o
     JOIN users u ON u.id = o.user_id
     WHERE u.email_normalized = $1 AND o.purpose = $2
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [normalizeEmail(email), purpose]
  );
  const row = rows[0];
  if (!row) return null;
  return openActionToken({
    outboxId: row.outbox_id,
    userId: row.user_id,
    purpose: row.purpose,
    actionTokenId: row.action_token_id,
    keyId: row.action_token_key_id,
    ciphertext: row.action_token_ciphertext,
    iv: row.action_token_iv,
    tag: row.action_token_tag,
  });
};

export { pool };

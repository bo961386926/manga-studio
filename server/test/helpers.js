// Shared test helpers for server-side node:test suites.
import crypto from 'node:crypto';
import { pool, runMigrations } from '../db.js';
import { normalizeEmail } from '../auth/password.js';

// Apply pending migrations against the connected (test) database.
export const ensureMigrated = async () => {
  await runMigrations();
};

// Clear identity tables so tests are repeatable against a shared test DB.
export const resetIdentityTables = async () => {
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

export { pool };

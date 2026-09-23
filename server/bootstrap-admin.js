#!/usr/bin/env node
// Offline bootstrap CLI: creates the first admin under maintenance mode with a
// PostgreSQL advisory lock. The admin password is always set later through the
// setup URL (URL fragment token); never accept a plaintext password env var.
import { pathToFileURL } from 'node:url';
import { pool, withTransaction, getConfig } from './db.js';
import { normalizeEmail } from './auth/password.js';
import { hashToken, randomToken } from './auth/tokens.js';
import { recordAudit } from './auth/audit.js';

const ADVISORY_LOCK_KEY = 7273100001; // 'MSBOOTS' numeric

export const createBootstrapToken = async ({ email }) => {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('invalid email address');
  const token = randomToken(32);
  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
  const setupUrl = `${base}/#/bootstrap?token=${encodeURIComponent(token)}`;
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (id, email, email_normalized, password_hash, role, status)
       VALUES (gen_random_uuid(), $1, $2, $3, 'admin', 'pending_verification')
       RETURNING id`,
      [normalized, normalized, 'bootstrap-pending']
    );
    const userId = rows[0].id;
    await client.query(
      `INSERT INTO user_action_tokens (id, user_id, purpose, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, 'bootstrap_admin', $2, NOW() + interval '24 hours')`,
      [userId, hashToken(token)]
    );
  });
  return { token, setupUrl };
};

export const runBootstrap = async ({ email }) => {
  const maintenance = await getConfig('maintenance_mode');
  if (maintenance !== true) {
    throw new Error('maintenance mode required (set config maintenance_mode=true first)');
  }
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND status = 'active'`
    );
    if (rows[0].c > 0) {
      throw new Error('active admin exists; bootstrap refused');
    }
    const result = await createBootstrapToken({ email });
    await recordAudit({
      eventType: 'auth.bootstrap_admin',
      result: 'success',
      metadata: { action: 'bootstrap', detail: 'pending admin created' },
    });
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = process.argv.find((a) => a.startsWith('--email='));
  const email = arg ? arg.slice('--email='.length) : process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    console.error('usage: node bootstrap-admin.js --email=<admin@example.com>');
    process.exit(2);
  }
  try {
    const { setupUrl } = await runBootstrap({ email });
    console.log('Bootstrap admin created (pending verification).');
    console.log('Open this URL ONCE from a protected terminal to set the password:');
    console.log(setupUrl);
  } catch (err) {
    console.error('bootstrap failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

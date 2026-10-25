import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'manga_studio',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

// Legacy baseline tables kept until the ownership migration (002) reworks them.
const ensureBaseTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id            VARCHAR(64) PRIMARY KEY,
      data          JSONB NOT NULL DEFAULT '{}',
      last_modified BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id         VARCHAR(64) PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key   VARCHAR(255) PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);
};

// Apply pending `server/migrations/*.sql` files in lexical order, each inside
// its own transaction, and record applied filenames in schema_migrations.
export const runMigrations = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const dir = path.join(__dirname, 'migrations');
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      : [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)',
          [file, Date.now()]
        );
        await client.query('COMMIT');
        console.log(`[DB] Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
};

export const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Transaction bound to the authenticated user context for RLS (GUC). Missing
// GUC fails closed on non-superuser connections (see 003 migration policies).
export const withUserContext = async ({ userId, isAdmin = false }, fn) => {
  // userId comes from a server session and must be a UUID; we still validate
  // because SET LOCAL cannot use parameter placeholders.
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('invalid user context');
  }
  return withTransaction(async (client) => {
    await client.query(`SET LOCAL app.user_id = '${userId}'`);
    await client.query(`SET LOCAL app.is_admin = '${isAdmin ? 'true' : 'false'}'`);
    return fn(client);
  });
};

export const closePool = async () => {
  await pool.end();
};

const initDB = async () => {
  const client = await pool.connect();
  try {
    await ensureBaseTables(client);
  } finally {
    client.release();
  }
  await runMigrations();
  console.log('[DB] Tables initialized successfully');
};

// ========== Config (legacy; stage-2 migrates to settings namespaces) ==========

export const getConfig = async (key) => {
  const result = await pool.query('SELECT value FROM config WHERE key = $1', [key]);
  if (result.rows.length === 0) return null;
  return result.rows[0].value;
};

export const setConfig = async (key, value) => {
  await pool.query(
    `INSERT INTO config (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)]
  );
};

export const removeConfig = async (key) => {
  await pool.query('DELETE FROM config WHERE key = $1', [key]);
};

export { pool, initDB };

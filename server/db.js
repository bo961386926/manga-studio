import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'manga_studio',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

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

// ========== Projects ==========

export const getAllProjects = async () => {
  const result = await pool.query(
    'SELECT data, last_modified FROM projects ORDER BY last_modified DESC'
  );
  return result.rows.map((row) => ({
    ...row.data,
    lastModified: parseInt(row.last_modified) || row.data.lastModified,
  }));
};

export const getProject = async (id) => {
  const result = await pool.query('SELECT data FROM projects WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return result.rows[0].data;
};

export const saveProject = async (id, data) => {
  const lastModified = data.lastModified || Date.now();
  await pool.query(
    `INSERT INTO projects (id, data, last_modified)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = $2, last_modified = $3`,
    [id, JSON.stringify(data), lastModified]
  );
};

export const deleteProject = async (id) => {
  await pool.query('DELETE FROM projects WHERE id = $1', [id]);
};

// ========== Assets ==========

export const getAllAssets = async () => {
  const result = await pool.query(
    'SELECT data, updated_at FROM assets ORDER BY updated_at DESC'
  );
  return result.rows.map((row) => ({
    ...row.data,
    updatedAt: parseInt(row.updated_at) || row.data.updatedAt,
  }));
};

export const saveAsset = async (id, data) => {
  const updatedAt = data.updatedAt || Date.now();
  await pool.query(
    `INSERT INTO assets (id, data, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = $3`,
    [id, JSON.stringify(data), updatedAt]
  );
};

export const deleteAsset = async (id) => {
  await pool.query('DELETE FROM assets WHERE id = $1', [id]);
};

// ========== Config ==========

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

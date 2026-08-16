import pg from 'pg';

const { Pool } = pg;

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

const initDB = async () => {
  const client = await pool.connect();
  try {
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
    console.log('[DB] Tables initialized successfully');
  } finally {
    client.release();
  }
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
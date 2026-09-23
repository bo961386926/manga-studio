// User-scoped asset data access. Every function requires userId first.
import { pool } from '../db.js';

export const getAllAssets = async (userId) => {
  const result = await pool.query(
    'SELECT data, updated_at FROM assets WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows.map((row) => ({
    ...row.data,
    updatedAt: parseInt(row.updated_at) || row.data.updatedAt,
  }));
};

export const getAsset = async (userId, id) => {
  const { rows } = await pool.query(
    'SELECT data FROM assets WHERE user_id = $1 AND id = $2',
    [userId, id]
  );
  return rows[0]?.data ?? null;
};

export const saveAsset = async (userId, id, data) => {
  const updatedAt = data.updatedAt || Date.now();
  await pool.query(
    `INSERT INTO assets (user_id, id, data, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, id) DO UPDATE SET data = $3, updated_at = $4`,
    [userId, id, JSON.stringify(data), updatedAt]
  );
};

export const deleteAsset = async (userId, id) => {
  await pool.query('DELETE FROM assets WHERE user_id = $1 AND id = $2', [userId, id]);
};

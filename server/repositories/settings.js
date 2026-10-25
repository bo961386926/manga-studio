// User and system settings repositories. User settings are always scoped by
// userId; system settings require admin (enforced at the route layer).
import { pool } from '../db.js';

export const getAllUserSettings = async (userId) => {
  const { rows } = await pool.query(
    'SELECT key, value FROM user_settings WHERE user_id = $1',
    [userId]
  );
  return rows;
};

export const getUserSetting = async (userId, key) => {
  const { rows } = await pool.query(
    'SELECT value FROM user_settings WHERE user_id = $1 AND key = $2',
    [userId, key]
  );
  return rows[0]?.value ?? null;
};

export const setUserSetting = async (userId, key, value) => {
  await pool.query(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [userId, key, JSON.stringify(value)]
  );
};

export const removeUserSetting = async (userId, key) => {
  await pool.query('DELETE FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
};

export const getSystemSetting = async (key) => {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
};

export const setSystemSetting = async (key, value) => {
  await pool.query(
    `INSERT INTO system_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
};

export const removeSystemSetting = async (key) => {
  await pool.query('DELETE FROM system_settings WHERE key = $1', [key]);
};

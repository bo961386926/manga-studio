// Shared test helpers for server-side node:test suites.
import { pool } from '../db.js';

export const listTables = async () => {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  return rows.map((r) => r.tablename);
};

export { pool };

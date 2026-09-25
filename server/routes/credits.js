// 积分余额与最近流水。
import { Router } from 'express';
import { pool } from '../db.js';
import { requireUser, wrap } from '../auth/middleware.js';
import { getBalance } from '../credits.js';

export const creditsRouter = Router();

creditsRouter.use(wrap(requireUser));

creditsRouter.get(
  '/balance',
  wrap(async (req, res) => {
    const balance = await getBalance(req.user.user_id);
    const { rows } = await pool.query(
      `SELECT delta, balance_after, reason, note, created_at
       FROM credit_ledger WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.user_id]
    );
    res.json({ balance, ledger: rows });
  })
);

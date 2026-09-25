// 积分余额与最近流水。
import { Router } from 'express';
import { pool } from '../db.js';
import { requireUser, wrap } from '../auth/middleware.js';
import { PolicyError } from '../model-gateway/policy.js';
import { getBalance } from '../credits.js';
import { checkIn, redeemCode, getReferralInfo } from '../activities.js';

export const creditsRouter = Router();

creditsRouter.use(wrap(requireUser));

creditsRouter.post(
  '/checkin',
  wrap(async (req, res) => {
    try {
      res.json(await checkIn(req.user.user_id));
    } catch (e) {
      if (e instanceof PolicyError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  })
);

creditsRouter.post(
  '/redeem',
  wrap(async (req, res) => {
    try {
      res.json(await redeemCode(req.user.user_id, req.body?.code));
    } catch (e) {
      if (e instanceof PolicyError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  })
);

creditsRouter.get(
  '/referral',
  wrap(async (req, res) => {
    res.json(await getReferralInfo(req.user.user_id));
  })
);

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

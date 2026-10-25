// 站内通知路由：列表（含未读数）、单条已读、全部已读。全部要求登录会话。
import { Router } from 'express';
import { pool } from '../db.js';
import { requireUser, wrap } from '../auth/middleware.js';

export const notificationsRouter = Router();

notificationsRouter.use(wrap(requireUser));

notificationsRouter.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, kind, payload, read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.user_id]
    );
    const { rows: unread } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user.user_id]
    );
    res.json({ notifications: rows, unread: unread[0].c });
  })
);

notificationsRouter.post(
  '/:id/read',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
      [req.params.id, req.user.user_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'notification not found' });
    res.json({ success: true });
  })
);

notificationsRouter.post(
  '/read-all',
  wrap(async (req, res) => {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [
      req.user.user_id,
    ]);
    res.json({ success: true });
  })
);

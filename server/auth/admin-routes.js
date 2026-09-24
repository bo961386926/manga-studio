// Admin routes: user listing, VIP grants, registration switch, user disable.
// Every route requires an admin session; high-risk actions additionally
// require recent reauthentication (15-minute window).
import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import {
  requireUser,
  requireAdmin,
  requireRecentReauth,
  adminLimiter,
  hashIp,
  wrap,
} from './middleware.js';
import { grantVip, revokeVip, countActiveAdmins, setRegistrationOpen } from './entitlements.js';
import { recordAudit } from './audit.js';
import { importModelConfig } from '../migration/legacy-config.js';

export const adminRouter = Router();

// Every admin route requires an authenticated session first; requireAdmin
// then enforces the admin role.
adminRouter.use(wrap(requireUser));

const auditAdmin = (req, { eventType, result, targetUserId = null, metadata = {} }) =>
  recordAudit({
    actorUserId: req.user.user_id,
    targetUserId,
    eventType,
    result,
    requestId: req.id,
    ipHash: hashIp(req.ip),
    metadata: { action: eventType, ...metadata },
  });

// Sensitive admin actions require recent reauthentication.
const sensitive = [requireRecentReauth];

// ---------- legacy model config import (browser migration wizard) ----------

adminRouter.post(
  '/migration/model-config',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(async (req, res) => {
    const { registry, apiKey, modelConfig } = req.body || {};
    if (!registry) return res.status(422).json({ error: 'registry is required' });
    const report = await importModelConfig({ adminId: req.user.user_id, registry, apiKey, modelConfig });
    res.json(report);
  })
);

// ---------- user list ----------

adminRouter.get(
  '/users',
  adminLimiter,
  wrap(requireAdmin),
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where = 'WHERE email_normalized LIKE $1';
    }
    const { rows } = await pool.query(
      `SELECT id, email, role, status, email_verified_at, created_at, last_login_at
       FROM users ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    await auditAdmin(req, { eventType: 'admin.users.list', result: 'success' });
    res.json({ users: rows });
  })
);

// ---------- VIP grant / revoke ----------

adminRouter.post(
  '/users/:id/vip',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(async (req, res) => {
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(422).json({ error: 'invalid expiresAt' });
    }
    await grantVip({ userId: req.params.id, expiresAt, grantedBy: req.user.user_id });
    await auditAdmin(req, {
      eventType: 'admin.vip.grant',
      result: 'success',
      targetUserId: req.params.id,
      metadata: { detail: expiresAt ? `until ${expiresAt.toISOString()}` : 'permanent' },
    });
    res.json({ success: true });
  })
);

adminRouter.delete(
  '/users/:id/vip',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(async (req, res) => {
    await revokeVip({ userId: req.params.id });
    await auditAdmin(req, {
      eventType: 'admin.vip.revoke',
      result: 'success',
      targetUserId: req.params.id,
    });
    res.json({ success: true });
  })
);

// ---------- registration switch ----------

adminRouter.put(
  '/registration',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(async (req, res) => {
    const open = Boolean(req.body?.open);
    await setRegistrationOpen(open);
    await auditAdmin(req, {
      eventType: 'admin.registration.set',
      result: 'success',
      metadata: { detail: open ? 'open' : 'closed' },
    });
    res.json({ success: true, open });
  })
);

// ---------- disable user (last-admin guard) ----------

adminRouter.post(
  '/users/:id/disable',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(async (req, res) => {
    const targetId = req.params.id;
    const { rows } = await pool.query(
      'SELECT id, role, status FROM users WHERE id = $1',
      [targetId]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (target.role === 'admin' && target.status === 'active') {
      const admins = await countActiveAdmins();
      if (admins <= 1) {
        return res.status(409).json({ error: 'cannot disable the last active admin' });
      }
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET status = 'disabled', updated_at = NOW() WHERE id = $1`,
        [targetId]
      );
      await client.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1', [targetId]);
    });
    await auditAdmin(req, {
      eventType: 'admin.user.disable',
      result: 'success',
      targetUserId: targetId,
    });
    res.json({ success: true });
  })
);

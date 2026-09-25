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
  csrfProtection,
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


// ---------- announcements (admin publish/manage) ----------

const ANNOUNCEMENT_LEVELS = new Set(['info', 'warning', 'critical']);

adminRouter.get(
  '/announcements',
  adminLimiter,
  wrap(requireAdmin),
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, title, body, level, starts_at, ends_at, created_at FROM announcements ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ announcements: rows });
  })
);

adminRouter.post(
  '/announcements',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const { title, body, level = 'info', startsAt, endsAt } = req.body || {};
    if (!title || !body) return res.status(422).json({ error: 'title and body are required' });
    if (!ANNOUNCEMENT_LEVELS.has(level)) return res.status(422).json({ error: 'invalid level' });
    const starts = startsAt ? new Date(startsAt) : new Date();
    const ends = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(starts.getTime()) || (ends && Number.isNaN(ends.getTime()))) {
      return res.status(422).json({ error: 'invalid date' });
    }
    const { rows } = await pool.query(
      `INSERT INTO announcements (id, title, body, level, starts_at, ends_at, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING id`,
      [String(title).slice(0, 200), body, level, starts, ends, req.user.user_id]
    );
    await auditAdmin(req, { eventType: 'admin.announcement.create', result: 'success', metadata: { detail: level } });
    res.json({ id: rows[0].id });
  })
);

adminRouter.delete(
  '/announcements/:id',
  adminLimiter,
  wrap(requireAdmin),
  ...sensitive,
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'announcement not found' });
    await auditAdmin(req, { eventType: 'admin.announcement.delete', result: 'success' });
    res.json({ success: true });
  })
);

// ---------- registration status (read-only for the admin panel) ----------

adminRouter.get(
  '/registration',
  adminLimiter,
  wrap(requireAdmin),
  wrap(async (req, res) => {
    const { isRegistrationOpen } = await import('./entitlements.js');
    res.json({ open: await isRegistrationOpen() });
  })
);

// ---------- ops overview (read-only counters for the admin panel) ----------

adminRouter.get(
  '/stats/overview',
  adminLimiter,
  wrap(requireAdmin),
  wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users_total,
        (SELECT COUNT(*)::int FROM users WHERE status = 'active' AND email_verified_at IS NOT NULL) AS users_verified,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - interval '24 hours') AS users_new_24h,
        (SELECT COUNT(*)::int FROM projects) AS projects_total,
        (SELECT COUNT(*)::int FROM model_invocations WHERE created_at > NOW() - interval '24 hours') AS invocations_24h,
        (SELECT COUNT(*)::int FROM model_invocations WHERE status = 'failed' AND created_at > NOW() - interval '24 hours') AS invocations_failed_24h
    `);
    const s = rows[0];
    res.json({
      ...s,
      failure_rate_24h:
        s.invocations_24h > 0 ? Number((s.invocations_failed_24h / s.invocations_24h).toFixed(4)) : 0,
    });
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

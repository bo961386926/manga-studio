// Migration import routes: authenticated admin import of encrypted legacy
// envelopes with one-time replay protection.
import { Router } from 'express';
import { withTransaction, pool } from '../db.js';
import {
  requireUser,
  requireAdmin,
  requireRecentReauth,
  adminLimiter,
  hashIp,
  wrap,
} from '../auth/middleware.js';
import { openEnvelope } from '../migration/envelope.js';
import { importModelConfig } from '../migration/legacy-config.js';
import { recordAudit } from '../auth/audit.js';

export const migrationRouter = Router();

migrationRouter.use(wrap(requireUser));

// Import a v1 envelope produced by the old Electron release. The export id is
// bound once to (deployment, importing admin) so replay is rejected.
migrationRouter.post(
  '/import',
  adminLimiter,
  wrap(requireAdmin),
  wrap(requireRecentReauth),
  wrap(async (req, res) => {
    const { envelope, password, deploymentId } = req.body || {};
    if (!envelope || typeof password !== 'string' || !deploymentId) {
      return res.status(422).json({ error: 'envelope, password and deploymentId are required' });
    }
    let opened;
    try {
      opened = await openEnvelope(envelope, password);
    } catch (err) {
      await recordAudit({
        actorUserId: req.user.user_id,
        eventType: 'migration.import',
        result: 'failure',
        requestId: req.id,
        ipHash: hashIp(req.ip),
        metadata: { action: 'import', detail: err.message },
      });
      return res.status(400).json({ error: err.message });
    }
    const { exportId, config } = opened;

    const bound = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO migration_imports (id, export_id, imported_by, deployment_id, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (export_id) DO NOTHING
         RETURNING id`,
        [exportId, req.user.user_id, deploymentId, new Date(envelope.expiresAt)]
      );
      return rows.length > 0;
    });
    if (!bound) {
      await recordAudit({
        actorUserId: req.user.user_id,
        eventType: 'migration.import',
        result: 'failure',
        requestId: req.id,
        ipHash: hashIp(req.ip),
        metadata: { action: 'import', detail: 'replay rejected' },
      });
      return res.status(409).json({ error: 'envelope already imported' });
    }

    const report = await importModelConfig({
      adminId: req.user.user_id,
      registry: config.registry,
      apiKey: config.apiKey,
      modelConfig: config.modelConfig,
    });
    await recordAudit({
      actorUserId: req.user.user_id,
      targetUserId: req.user.user_id,
      eventType: 'migration.import',
      result: 'success',
      requestId: req.id,
      ipHash: hashIp(req.ip),
      metadata: { action: 'import', detail: `export=${exportId}` },
    });
    res.json({ exportId, ...report });
  })
);

// Look up the current admin's migration status (masked only).
migrationRouter.get(
  '/status',
  wrap(requireAdmin),
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT export_id, deployment_id, created_at FROM migration_imports
       WHERE imported_by = $1 ORDER BY created_at DESC LIMIT 5`,
      [req.user.user_id]
    );
    res.json({ imports: rows });
  })
);

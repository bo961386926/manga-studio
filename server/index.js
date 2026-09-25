import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { initDB } from './db.js';
import {
  getProject,
  saveProject,
  deleteProject,
  getProjectMetaList,
} from './repositories/projects.js';
import { getAllAssets, getAsset, saveAsset, deleteAsset } from './repositories/assets.js';
import {
  getUserSetting,
  setUserSetting,
  removeUserSetting,
  getSystemSetting,
  setSystemSetting,
  removeSystemSetting,
} from './repositories/settings.js';
import {
  requestId,
  securityHeaders,
  corsAllowlist,
  anonymousMutationGuard,
  requireUser,
  requireAdmin,
  csrfProtection,
  wrap,
} from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { adminRouter } from './auth/admin-routes.js';
import { migrationRouter } from './routes/migration.js';
import { modelGatewayRouter } from './routes/model-gateway.js';
import { pool } from './db.js';
import { startOutboxWorker } from './auth/outbox.js';
import { startNotificationScheduler } from './notifications.js';
import { notificationsRouter } from './routes/notifications.js';
import { startBackupScheduler } from './backup.js';

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001');

// Exactly one trusted proxy hop (nginx): req.ip is the real client address,
// so rate limits and IP audit hashes do not collapse onto the proxy IP.
app.set('trust proxy', 1);

app.use(requestId);
app.use(securityHeaders);
app.use(corsAllowlist);
// Per-route JSON body limits: small by default, larger only where payloads
// legitimately carry base64 media. nginx client_max_body_size remains the
// outer bound; unauthenticated endpoints now parse at most 1MB.
app.use('/api/model-invocations/media-assets', express.json({ limit: '150mb' }));
app.use('/api/model-invocations', express.json({ limit: '1mb' }));
app.use('/api/projects', express.json({ limit: '100mb' }));
app.use('/api/assets', express.json({ limit: '100mb' }));
app.use('/api', express.json({ limit: '1mb' }));
app.use(anonymousMutationGuard);

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/migration', migrationRouter);
app.use('/api/model-invocations', modelGatewayRouter);
app.use('/api/notifications', notificationsRouter);

// 公告：生效中的公告对所有人可见（未开始的/已结束的不展示）
app.get('/api/announcements/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT title, body, level, starts_at, ends_at FROM announcements
       WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY (level = 'critical') DESC, created_at DESC LIMIT 5`
    );
    res.json({ announcements: rows });
  } catch (e) {
    console.error('[API] announcements error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ==================== Projects (user-scoped) ====================

app.get('/api/projects', wrap(requireUser), async (req, res) => {
  try {
    const projects = await getProjectMetaList(req.user.user_id);
    res.json(projects);
  } catch (e) {
    console.error('[API] getAllProjects error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', wrap(requireUser), async (req, res) => {
  try {
    const project = await getProject(req.user.user_id, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    console.error('[API] getProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    const { id, ...data } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const payloadSize = JSON.stringify(req.body).length;
    const title = data.title || '(untitled)';
    const shotsCount = Array.isArray(data.shots) ? data.shots.length : 0;
    const renderLogsCount = Array.isArray(data.renderLogs) ? data.renderLogs.length : 0;
    console.log(`[API] saveProject - id: ${id}, title: "${title}", payload: ${(payloadSize / 1024 / 1024).toFixed(2)}MB, shots: ${shotsCount}, renderLogs: ${renderLogsCount}`);
    await saveProject(req.user.user_id, id, { id, ...data });
    console.log(`[API] saveProject - 保存成功: ${id}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] saveProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    const project = await getProject(req.user.user_id, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await deleteProject(req.user.user_id, req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] deleteProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== Assets (user-scoped) ====================

app.get('/api/assets', wrap(requireUser), async (req, res) => {
  try {
    const assets = await getAllAssets(req.user.user_id);
    res.json(assets);
  } catch (e) {
    console.error('[API] getAllAssets error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assets', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    const { id, ...data } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await saveAsset(req.user.user_id, id, { id, ...data });
    res.json({ success: true });
  } catch (e) {
    console.error('[API] saveAsset error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assets/:id', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    const asset = await getAsset(req.user.user_id, req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    await deleteAsset(req.user.user_id, req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] deleteAsset error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== Settings (user + system) ====================
// Legacy /api/config/:key is migration-only and retired (410).

const SETTING_KEY_RE = /^[A-Za-z0-9_.-]{1,255}$/;
const validSettingKey = (key) => typeof key === 'string' && SETTING_KEY_RE.test(key);

app.get('/api/user/settings/:key', wrap(requireUser), async (req, res) => {
  try {
    if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
    const value = await getUserSetting(req.user.user_id, req.params.key);
    if (value === null) return res.status(404).json({ error: 'Setting not found' });
    res.json(value);
  } catch (e) {
    console.error('[API] getUserSetting error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/user/settings/:key', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
    await setUserSetting(req.user.user_id, req.params.key, req.body?.value);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] setUserSetting error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/user/settings/:key', wrap(requireUser), wrap(csrfProtection), async (req, res) => {
  try {
    if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
    await removeUserSetting(req.user.user_id, req.params.key);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] removeUserSetting error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/system-settings/:key', wrap(requireUser), wrap(requireAdmin), async (req, res) => {
  try {
    if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
    const value = await getSystemSetting(req.params.key);
    if (value === null) return res.status(404).json({ error: 'Setting not found' });
    res.json(value);
  } catch (e) {
    console.error('[API] getSystemSetting error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put(
  '/api/admin/system-settings/:key',
  wrap(requireUser),
  wrap(requireAdmin),
  wrap(csrfProtection),
  async (req, res) => {
    try {
      if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
      await setSystemSetting(req.params.key, req.body?.value);
      res.json({ success: true });
    } catch (e) {
      console.error('[API] setSystemSetting error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

app.delete(
  '/api/admin/system-settings/:key',
  wrap(requireUser),
  wrap(requireAdmin),
  wrap(csrfProtection),
  async (req, res) => {
    try {
      if (!validSettingKey(req.params.key)) return res.status(422).json({ error: 'invalid key' });
      await removeSystemSetting(req.params.key);
      res.json({ success: true });
    } catch (e) {
      console.error('[API] removeSystemSetting error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// Legacy global config route: migration-only, retired after stage-2 import.
app.all('/api/config/:key', (_req, res) => {
  res.status(410).json({ error: 'legacy config endpoint retired; use /api/user/settings' });
});

// ==================== Health ====================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ==================== Start ====================

export const startServer = () => {
  initDB()
    .then(() => {
      startOutboxWorker();
      startBackupScheduler();
      startNotificationScheduler();
      app.listen(PORT, () => {
        console.log(`[Server] API server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Server] Failed to initialize database:', err);
      process.exit(1);
    });
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}

export { app };
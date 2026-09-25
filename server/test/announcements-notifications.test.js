// Stage-5: announcements (public read + admin CRUD with reauth) and
// notifications (list/read/read-all, job terminal notifications).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  pool,
} from './helpers.js';
import { hashPassword } from '../auth/password.js';
import crypto from 'node:crypto';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let adminCsrf;
let adminCookie;
let userCookie;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  ({ server, baseUrl } = await startTestServer());
  await pool.query('TRUNCATE announcements');
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES (gen_random_uuid(), 'ad@example.com', 'ad@example.com', $1, 'admin', 'active', NOW())`,
    [await hashPassword('AdminPass123')]
  );
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES (gen_random_uuid(), 'u@example.com', 'u@example.com', $1, 'user', 'active', NOW())`,
    [await hashPassword('UserPass123')]
  );
  const admin = await login('ad@example.com', 'AdminPass123');
  adminCookie = admin.cookie;
  adminCsrf = admin.csrf;
  // 敏感操作解锁
  await request('/api/auth/reauthenticate', {
    method: 'POST',
    json: { password: 'AdminPass123' },
    cookie: adminCookie,
    headers: { 'x-csrf-token': adminCsrf },
  });
  const user = await login('u@example.com', 'UserPass123');
  userCookie = user.cookie;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const request = (path, { method = 'GET', json, cookie, headers = {} } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

const login = async (email, password) => {
  const res = await request('/api/auth/login', { method: 'POST', json: { email, password } });
  assert.equal(res.status, 200);
  return {
    cookie: (res.headers.get('set-cookie') || '').split(';')[0],
    csrf: (await res.json()).csrfToken,
  };
};

test('admin publishes an announcement (reauth gated) and it becomes publicly visible', async () => {
  const created = await request('/api/admin/announcements', {
    method: 'POST',
    json: { title: '系统维护通知', body: '周六 02:00-03:00 例行维护', level: 'warning' },
    cookie: adminCookie,
    headers: { 'x-csrf-token': adminCsrf },
  });
  assert.equal(created.status, 200);
  const { id } = await created.json();

  // 公开读取（未登录）
  const pub = await request('/api/announcements/active');
  assert.equal(pub.status, 200);
  const list = (await pub.json()).announcements;
  assert.equal(list.length, 1);
  assert.equal(list[0].level, 'warning');

  // 删除后不再可见
  const del = await request(`/api/admin/announcements/${id}`, {
    method: 'DELETE',
    cookie: adminCookie,
    headers: { 'x-csrf-token': adminCsrf },
  });
  assert.equal(del.status, 200);
  const after = await request('/api/announcements/active');
  assert.equal((await after.json()).announcements.length, 0);
});

test('non-admin cannot publish announcements', async () => {
  const res = await request('/api/admin/announcements', {
    method: 'POST',
    json: { title: 'x', body: 'y' },
    cookie: userCookie,
    headers: { 'x-csrf-token': 'whatever' },
  });
  assert.ok([403, 401].includes(res.status));
});

test('notifications list, mark read and read-all', async () => {
  // 直接写入两条通知
  const { rows: [uid] } = await pool.query("SELECT id FROM users WHERE email='u@example.com'");
  await pool.query(
    `INSERT INTO notifications (id, user_id, kind, payload)
     VALUES (gen_random_uuid(), $1, 'system', '{}'), (gen_random_uuid(), $1, 'job_done', '{}')`,
    [uid.id]
  );
  const list = await request('/api/notifications', { cookie: userCookie });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.notifications.length, 2);
  assert.equal(body.unread, 2);

  const mark = await request(`/api/notifications/${body.notifications[0].id}/read`, {
    method: 'POST',
    cookie: userCookie,
  });
  assert.equal(mark.status, 200);
  const after = await request('/api/notifications', { cookie: userCookie });
  assert.equal((await after.json()).unread, 1);

  const all = await request('/api/notifications/read-all', { method: 'POST', cookie: userCookie });
  assert.equal(all.status, 200);
  const final = await request('/api/notifications', { cookie: userCookie });
  assert.equal((await final.json()).unread, 0);
});

test('job failure creates a notification via pollJob', async () => {
  const { createAsyncJob, pollJob } = await import('../model-gateway/gateway.js');
  const providerId = crypto.randomUUID();
  const modelId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type)
     VALUES ($1, NULL, 'shared', 'Dbg', 'https://mock.example', 'none')`,
    [providerId]
  );
  await pool.query(
    `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset, endpoint_path, access_level)
     VALUES ($1, $2, 'DbgV', 'm1', 'video', 'legacy', 'openai-video-async', '/videos', 'verified')`,
    [modelId, providerId]
  );
  const provider = { id: providerId, scope: 'shared', owner_user_id: null, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 };
  const model = {
    id: modelId, api_model: 'm1', capability: 'video', adapter_kind: 'legacy',
    protocol_preset: 'openai-video-async', endpoint_path: '/videos', access_level: 'verified',
    enabled: true, deleted_at: null, protocol_config: {}, timeout_ms: 0,
    provider,
  };
  const { rows: [uid] } = await pool.query("SELECT id FROM users WHERE email='u@example.com'");
  const created = await createAsyncJob({
    userId: uid.id, isAdmin: false, model, provider,
    idempotencyKey: `job-notif-${Date.now()}`,
    payload: { prompt: 'p', aspectRatio: '16:9', duration: 8 },
    deps: { fetchUpstream: async () => ({ taskId: 'task-1' }) },
  });
  const job = await (async () => {
    const { findJob } = await import('../model-gateway/gateway.js');
    return findJob({ userId: uid.id, isAdmin: false, jobId: created.jobId });
  })();
  assert.equal(job.status, 'queued');
  const finished = await pollJob({
    userId: uid.id, isAdmin: false, job,
    deps: {
      fetchJobStatus: async () => ({ state: 'failure', error: 'content blocked' }),
      downloadJobResult: async () => { throw new Error('should not download'); },
    },
  });
  assert.equal(finished.status, 'failed');
  const { rows } = await pool.query(
    "SELECT kind FROM notifications WHERE user_id = $1 AND kind = 'job_failed'",
    [uid.id]
  );
  assert.equal(rows.length, 1);
});

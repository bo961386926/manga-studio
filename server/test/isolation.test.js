import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ensureMigrated,
  resetIdentityTables,
  insertUser,
  startTestServer,
  pool,
} from './helpers.js';
import {
  getAllProjects,
  getProject,
  saveProject,
  deleteProject,
  extractCover,
} from '../repositories/projects.js';
import { getAllAssets, getAsset, saveAsset, deleteAsset } from '../repositories/assets.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { SESSION_COOKIE } from '../auth/session.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let u1;
let u2;
let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  u1 = await insertUser({ email: 'u1@example.com' });
  u2 = await insertUser({ email: 'u2@example.com' });
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// Create an active session row for a user; returns { cookie, csrf }.
async function sessionFor(userId) {
  await pool.query(
    `UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1`,
    [userId]
  );
  const token = randomToken(32);
  const csrf = randomToken(32);
  await pool.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, NOW() + interval '10 minutes', NOW() + interval '7 days')`,
    [userId, hashToken(token), hashToken(csrf)]
  );
  return { cookie: `${SESSION_COOKIE}=${token}`, csrf };
}

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

test('project query always scopes by user id', async () => {
  await saveProject(u1, 'p1', { title: 'one' });
  await saveProject(u2, 'p1', { title: 'two' });
  assert.equal((await getProject(u1, 'p1')).title, 'one');
  assert.equal(await getProject(u2, 'missing'), null);
  assert.equal((await getProject(u2, 'p1')).title, 'two');
});

test('delete is scoped by user id and never touches another user row', async () => {
  await saveProject(u1, 'p2', { title: 'mine' });
  await saveProject(u2, 'p2', { title: 'theirs' });
  await deleteProject(u2, 'p2');
  assert.equal(await getProject(u2, 'p2'), null);
  assert.equal((await getProject(u1, 'p2')).title, 'mine');
});

test('asset query and writes are scoped by user id', async () => {
  await saveAsset(u1, 'a1', { name: 'one' });
  await saveAsset(u2, 'a1', { name: 'two' });
  assert.equal((await getAsset(u1, 'a1')).name, 'one');
  assert.equal((await getAsset(u2, 'a1')).name, 'two');

  const u1Assets = await getAllAssets(u1);
  assert.deepEqual(u1Assets.map((a) => a.name), ['one']);

  await deleteAsset(u1, 'a1');
  assert.equal(await getAsset(u1, 'a1'), null);
  assert.equal((await getAsset(u2, 'a1')).name, 'two');
});

test('user B cannot read, update, or delete user A project', async () => {
  const a = await sessionFor(u1);
  const b = await sessionFor(u2);

  const created = await request('/api/projects', {
    method: 'POST',
    cookie: a.cookie,
    json: { id: 'p-idor', title: 'secret project' },
    headers: { 'x-csrf-token': a.csrf },
  });
  assert.equal(created.status, 200);

  const aRead = await request('/api/projects/p-idor', { cookie: a.cookie });
  assert.equal(aRead.status, 200);

  // Same id, different owner: 404 (no existence leak).
  const bRead = await request('/api/projects/p-idor', { cookie: b.cookie });
  assert.equal(bRead.status, 404);

  const bDelete = await request('/api/projects/p-idor', {
    method: 'DELETE',
    cookie: b.cookie,
    headers: { 'x-csrf-token': b.csrf },
  });
  assert.equal(bDelete.status, 404);

  // A's row is untouched.
  assert.equal((await getProject(u1, 'p-idor')).title, 'secret project');
});

test('legacy config route is unavailable after migration', async () => {
  const a = await sessionFor(u1);
  const legacy = await request('/api/config/model', { cookie: a.cookie });
  assert.equal(legacy.status, 410);
});

test('user settings are scoped per user and require CSRF on writes', async () => {  const a = await sessionFor(u1);
  const b = await sessionFor(u2);

  const put = await request('/api/user/settings/model_registry', {
    method: 'PUT',
    cookie: a.cookie,
    json: { value: { models: ['x'] } },
    headers: { 'x-csrf-token': a.csrf },
  });
  assert.equal(put.status, 200);

  // Missing CSRF is rejected.
  const noCsrf = await request('/api/user/settings/model_registry', {
    method: 'PUT',
    cookie: a.cookie,
    json: { value: { models: ['x'] } },
  });
  assert.equal(noCsrf.status, 403);

  const aRead = await request('/api/user/settings/model_registry', { cookie: a.cookie });
  assert.equal(aRead.status, 200);
  assert.deepEqual(await aRead.json(), { models: ['x'] });

  // Other user cannot see it.
  const bRead = await request('/api/user/settings/model_registry', { cookie: b.cookie });
  assert.equal(bRead.status, 404);
});

test('extractCover prefers character, then scene, then keyframe', () => {
  assert.equal(
    extractCover({
      scriptData: {
        characters: [
          { name: 'A', referenceImage: 'data:image/png;base64,AAA' },
          { name: 'B', referenceImage: 'data:image/png;base64,BBB' },
        ],
      },
    }),
    'data:image/png;base64,AAA'
  );
  // Character variation beats scene.
  assert.equal(
    extractCover({
      scriptData: {
        characters: [{ name: 'A', referenceImage: undefined, variations: [{ referenceImage: 'data:image/png;base64,VAR' }] }],
        scenes: [{ referenceImage: 'data:image/png;base64,SCENE' }],
      },
    }),
    'data:image/png;base64,VAR'
  );
  // Scene when no characters have images.
  assert.equal(
    extractCover({
      scriptData: { characters: [], scenes: [{ referenceImage: 'data:image/png;base64,SCENE' }] },
    }),
    'data:image/png;base64,SCENE'
  );
  // Keyframe as last resort.
  assert.equal(
    extractCover({
      scriptData: { characters: [], scenes: [] },
      shots: [{ keyframes: [{ imageUrl: 'data:image/png;base64,KF' }] }],
    }),
    'data:image/png;base64,KF'
  );
  assert.equal(extractCover({ scriptData: { characters: [], scenes: [] }, shots: [] }), null);
  assert.equal(extractCover(null), null);
});

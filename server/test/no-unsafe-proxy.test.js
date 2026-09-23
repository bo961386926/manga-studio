import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, startTestServer, pool } from './helpers.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('production route table has no arbitrary forwarding endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/ai-forward`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetUrl: 'https://example.com', body: {} }),
  });
  assert.equal(response.status, 404);
});

test('no route accepts a client targetUrl anymore', async () => {
  // All gateway routes live under /api/model-invocations; a targetUrl payload
  // must never be interpreted as an upstream target. Unauthenticated callers
  // are rejected (401) before any param check (422) — never proxied.
  const response = await fetch(`${baseUrl}/api/model-invocations/invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetUrl: 'https://evil.example', modelId: 'x', operation: 'chat' }),
  });
  assert.ok([401, 422].includes(response.status), `unexpected status ${response.status}`);
});

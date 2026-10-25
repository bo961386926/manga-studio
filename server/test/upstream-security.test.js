import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ensureMigrated, pool } from './helpers.js';
import {
  buildUpstreamRequest,
  fetchUpstream,
  resolveAndBind,
  isPrivateAddress,
  isForbiddenHeader,
} from '../model-gateway/upstream.js';
import {
  buildChatRequest,
  parseChatResponse,
  buildImageRequest,
  parseImageResponse,
  buildVideoCreateRequest,
  parseVideoCreateResponse,
  classifyVideoStatus,
  extractVideoResult,
  ProtocolError,
} from '../model-gateway/presets.js';
import {
  assertModelAccess,
  assertPrompt,
  assertAspectRatio,
  assertDuration,
  assertReferenceCount,
  PolicyError,
} from '../model-gateway/policy.js';

test.before(async () => {
  await ensureMigrated();
});

test.after(async () => {
  await pool.end();
});

test('client target URL and dangerous headers are rejected', () => {
  assert.throws(
    () => buildUpstreamRequest({ targetUrl: 'https://evil.example', headers: { Host: 'x' } }),
    /forbidden/
  );
  assert.throws(
    () => buildUpstreamRequest({ method: 'POST', headers: { 'X-Forwarded-For': '1.2.3.4' } }),
    /forbidden/
  );
  assert.throws(
    () => buildUpstreamRequest({ method: 'POST', headers: { Authorization: 'Bearer x' } }),
    /forbidden/
  );
  // Clean server-generated headers pass.
  assert.doesNotThrow(() =>
    buildUpstreamRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
  );
});

test('POST redirect is denied and private IP DNS binding is blocked', async () => {
  // Development/test localhost HTTP is allowed (for local test servers).
  assert.ok((await resolveAndBind('http://127.0.0.1')).ip);
  // Private/metadata addresses are rejected over HTTPS.
  await assert.rejects(resolveAndBind('https://10.0.0.1'), /private address/);
  await assert.rejects(resolveAndBind('https://169.254.169.254'), /private address/);
  await assert.rejects(resolveAndBind('https://[::1]'), /private address/);
  await assert.rejects(resolveAndBind('https://192.168.1.1'), /private address/);
  await assert.rejects(resolveAndBind('https://metadata.google.internal'), /metadata address/);
  // Plain HTTP to a non-localhost host is refused outright.
  await assert.rejects(resolveAndBind('http://10.0.0.1'), /insecure protocol/);

  // Local server exercising redirect policy.
  const srv = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/final' });
      res.end();
    } else if (req.url === '/cross') {
      res.writeHead(302, { Location: 'http://localhost:1/other' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const port = srv.address().port;
    const base = `http://127.0.0.1:${port}`;
    // POST to a redirecting endpoint is denied.
    await assert.rejects(fetchUpstream({ url: `${base}/redirect`, method: 'POST' }), /redirect denied/);
    // Same-origin GET follows the redirect and reaches the final response.
    const res = await fetchUpstream({ url: `${base}/redirect`, method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString('utf8'), 'ok');
    // Cross-origin redirect is denied.
    await assert.rejects(fetchUpstream({ url: `${base}/cross`, method: 'GET' }), /cross-origin/);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('private address detection covers mapped and reserved ranges', () => {
  assert.equal(isPrivateAddress('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('224.0.0.1'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('fc00::1'), true);
});

test('forbidden header detection is case-insensitive', () => {
  assert.equal(isForbiddenHeader('HOST'), true);
  assert.equal(isForbiddenHeader('Cookie'), true);
  assert.equal(isForbiddenHeader('X-Forwarded-Proto'), true);
  assert.equal(isForbiddenHeader('Proxy-Authorization'), true);
  assert.equal(isForbiddenHeader('Content-Type'), false);
  assert.equal(isForbiddenHeader('X-Custom-Header'), false);
});

test('openai-chat preset builds and parses strictly', () => {
  const req = buildChatRequest({
    apiModel: 'm1',
    prompt: 'hi',
    systemPrompt: 'sys',
    responseFormat: 'json',
    supportsJson: true,
  });
  assert.equal(req.model, 'm1');
  assert.deepEqual(req.response_format, { type: 'json_object' });
  assert.equal(req.stream, false);

  assert.equal(parseChatResponse({ choices: [{ message: { content: 'ok' } }] }), 'ok');
  assert.throws(() => parseChatResponse({ choices: [] }), ProtocolError);
  assert.throws(() => parseChatResponse({}), ProtocolError);
});

test('openai-image preset supports json and multipart modes', () => {
  const jsonReq = buildImageRequest({ apiModel: 'm1', prompt: 'p', size: '1280x720', responseFormat: 'b64_json' });
  assert.equal(jsonReq.kind, 'json');
  assert.equal(jsonReq.body.n, 1);

  const multi = buildImageRequest({
    apiModel: 'm1',
    prompt: 'p',
    size: '1280x720',
    responseFormat: 'url',
    referenceImages: [{ buffer: Buffer.from('x'), contentType: 'image/png', name: 'a.png' }],
  });
  assert.equal(multi.kind, 'multipart');
});

test('video presets identify task ids and classify statuses', () => {
  const create = buildVideoCreateRequest({ apiModel: 'm1', prompt: 'p', size: '1280x720', duration: 8 });
  assert.equal(create.duration, 8);

  assert.deepEqual(parseVideoCreateResponse({ id: 'task-1' }), { taskId: 'task-1' });
  assert.deepEqual(parseVideoCreateResponse({ task_id: 'task-2' }), { taskId: 'task-2' });
  assert.throws(() => parseVideoCreateResponse({}), ProtocolError);

  assert.equal(classifyVideoStatus({ status: 'queued' }), 'waiting');
  assert.equal(classifyVideoStatus({ status: 'completed' }), 'success');
  assert.equal(classifyVideoStatus({ status: 'failed' }), 'failure');
  assert.throws(() => classifyVideoStatus({ status: 'mystery' }), ProtocolError);

  assert.deepEqual(extractVideoResult({ url: 'https://cdn.example/v.mp4' }), {
    resourceId: 'https://cdn.example/v.mp4',
  });
  assert.deepEqual(extractVideoResult({ output: { id: 'res-1' } }), { resourceId: 'res-1' });
});

test('policy validates params and access', async () => {
  assert.throws(() => assertPrompt('', 'prompt'), PolicyError);
  assert.throws(() => assertPrompt('x'.repeat(300 * 1024), 'prompt'), (e) => e.code === 'PAYLOAD_TOO_LARGE');
  assert.doesNotThrow(() => assertPrompt('hello'));
  assert.throws(() => assertAspectRatio('4:3'), PolicyError);
  assert.throws(() => assertDuration(16, [8]), PolicyError);
  assert.doesNotThrow(() => assertDuration(8, [8]));
  assert.throws(() => assertReferenceCount(['not-a-uuid'], 1, 'refs'), PolicyError);
  assert.throws(() => assertReferenceCount(Array(17).fill('00000000-0000-0000-0000-000000000000'), 16, 'refs'), PolicyError);

  // Access: private model of another user -> 404-style denial.
  await assert.rejects(
    assertModelAccess({
      model: { id: 'm', deleted_at: null, enabled: true, access_level: 'verified' },
      provider: { id: 'p', scope: 'private', owner_user_id: 'other', deleted_at: null, enabled: true },
      userId: 'me',
      isAdmin: false,
    }),
    (e) => e instanceof PolicyError && e.status === 404
  );
});

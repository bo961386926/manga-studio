// Production fail-close guarantees: missing deployment secrets must refuse
// to operate instead of silently degrading to public dev constants, and the
// model gateway must inject server-side credentials into upstream calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sealSecret, requestHash } from '../model-gateway/crypto.js';
import { sealActionToken } from '../auth/outbox.js';
import { hashIp, rateLimit } from '../auth/middleware.js';
import { buildUpstreamCaller } from '../routes/model-gateway.js';

const withEnv = (overrides, fn) => {
  const saved = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    process.env = saved;
  }
};

const okUpstream = (capture) => async (opts) => {
  capture.headers = opts.headers;
  capture.url = opts.url;
  return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ ok: true })) };
};

test('crypto fails closed in production without MODEL_ENC_KEY', () => {
  withEnv({ NODE_ENV: 'production', MODEL_ENC_KEY: undefined }, () => {
    assert.throws(
      () => sealSecret('x', { ownerId: 'u', recordId: 'p', field: 'credential' }),
      /MODEL_ENC_KEY/
    );
  });
});

test('requestHash fails closed in production without REQUEST_HMAC_KEY', () => {
  withEnv({ NODE_ENV: 'production', REQUEST_HMAC_KEY: undefined }, () => {
    assert.throws(() => requestHash('{}'), /REQUEST_HMAC_KEY/);
  });
});

test('outbox action tokens fail closed in production without EMAIL_DELIVERY_KEY', () => {
  withEnv({ NODE_ENV: 'production', EMAIL_DELIVERY_KEY: undefined }, () => {
    assert.throws(
      () => sealActionToken({ outboxId: 'o', userId: 'u', purpose: 'email_verification', actionTokenId: 'a', token: 't' }),
      /EMAIL_DELIVERY_KEY/
    );
  });
});

test('IP audit hashing fails closed in production without IP_HMAC_SALT', () => {
  withEnv({ NODE_ENV: 'production', IP_HMAC_SALT: undefined }, () => {
    assert.throws(() => hashIp('1.2.3.4'), /IP_HMAC_SALT/);
  });
});

test('crypto and IP hashing keep working in development defaults', () => {
  withEnv({ NODE_ENV: 'development', MODEL_ENC_KEY: undefined, IP_HMAC_SALT: undefined }, () => {
    const sealed = sealSecret('x', { ownerId: 'u', recordId: 'p', field: 'credential' });
    assert.ok(sealed.ciphertext.length > 0);
    assert.match(hashIp('1.2.3.4'), /^[0-9a-f]{64}$/);
  });
});

const makeProvider = (overrides = {}) => ({
  id: 'prov1',
  auth_type: 'bearer',
  auth_header_name: null,
  timeout_ms: 0,
  ...overrides,
});

test('upstream caller injects bearer credential server-side', async () => {
  const sealed = sealSecret('sk-upstream', { ownerId: 'u1', recordId: 'prov1', field: 'credential' });
  const capture = {};
  const caller = buildUpstreamCaller({
    model: { auth_override_type: null, timeout_ms: 0, base_url_override: 'https://upstream.example.com', endpoint_path: '/v1/chat' },
    provider: makeProvider({
      credential: { versionId: 'cv1', ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, keyId: sealed.keyId, ownerId: 'u1' },
    }),
    deps: { fetchUpstream: okUpstream(capture) },
  });
  await caller.call({ jsonBody: { a: 1 }, parseResponse: (parsed) => parsed });
  assert.equal(capture.headers['Authorization'], 'Bearer sk-upstream');
  assert.ok(!capture.headers['x-api-key']);
});

test('upstream caller injects api-key-header credentials under the configured name', async () => {
  const sealed = sealSecret('sk-header', { ownerId: 'u1', recordId: 'prov1', field: 'credential' });
  const capture = {};
  const caller = buildUpstreamCaller({
    model: { auth_override_type: null, timeout_ms: 0, base_url_override: 'https://upstream.example.com', endpoint_path: '/v1/chat' },
    provider: makeProvider({
      auth_type: 'api-key-header',
      auth_header_name: 'X-Api-Key',
      credential: { versionId: 'cv1', ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, keyId: sealed.keyId, ownerId: 'u1' },
    }),
    deps: { fetchUpstream: okUpstream(capture) },
  });
  await caller.call({ jsonBody: { a: 1 }, parseResponse: (parsed) => parsed });
  assert.equal(capture.headers['X-Api-Key'], 'sk-header');
  assert.ok(!capture.headers['Authorization']);
});

test('upstream caller sends no auth headers for auth none or missing credential', async () => {
  const captureNone = {};
  const callerNone = buildUpstreamCaller({
    model: { auth_override_type: null, timeout_ms: 0, base_url_override: 'https://upstream.example.com', endpoint_path: '/v1/chat' },
    provider: makeProvider({ auth_type: 'none' }),
    deps: { fetchUpstream: okUpstream(captureNone) },
  });
  await callerNone.call({ jsonBody: { a: 1 }, parseResponse: (parsed) => parsed });
  assert.ok(!captureNone.headers['Authorization']);

  const captureMissing = {};
  const callerMissing = buildUpstreamCaller({
    model: { auth_override_type: null, timeout_ms: 0, base_url_override: 'https://upstream.example.com', endpoint_path: '/v1/chat' },
    provider: makeProvider({ auth_type: 'bearer', credential: null }),
    deps: { fetchUpstream: okUpstream(captureMissing) },
  });
  await callerMissing.call({ jsonBody: { a: 1 }, parseResponse: (parsed) => parsed });
  assert.ok(!captureMissing.headers['Authorization']);
});

test('model auth override takes precedence over provider auth type', async () => {
  const capture = {};
  const caller = buildUpstreamCaller({
    model: { auth_override_type: 'none', timeout_ms: 0, base_url_override: 'https://upstream.example.com', endpoint_path: '/v1/chat' },
    provider: makeProvider({ auth_type: 'bearer', credential: null }),
    deps: { fetchUpstream: okUpstream(capture) },
  });
  await caller.call({ jsonBody: { a: 1 }, parseResponse: (parsed) => parsed });
  assert.ok(!capture.headers['Authorization']);
});

const fakeRes = () => {
  const out = { statusCode: null };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = () => out;
  return out;
};

test('rate limit default key uses req.ip and isolates clients', () => {
  withEnv({ NODE_ENV: 'test' }, () => {
    const limiter = rateLimit({ windowMs: 60 * 1000, max: 1 });
    const a = { ip: '10.0.0.1' };
    const b = { ip: '10.0.0.2' };
    const res = fakeRes();
    limiter(a, res, () => { a.passed = true; });
    limiter(a, res, () => { a.passedTwice = true; });
    limiter(b, res, () => { b.passed = true; });
    assert.ok(a.passed);
    assert.ok(!a.passedTwice);
    assert.ok(b.passed);
    assert.equal(res.statusCode, 429);
  });
});

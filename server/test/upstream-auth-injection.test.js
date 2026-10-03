// 上游凭据注入的安全契约。
//
// 背景（实网测试发现的阻断缺陷）：网关注入上游凭据时把 Authorization 放进
// 普通 headers，而 buildUpstreamRequest 会拒绝一切 'authorization' 头——
// 于是**所有带凭据的上游调用都会以 "forbidden header" 失败**。历史上所有
// 调用测试都注入假 fetchUpstream，从未走到真实校验，所以一直没暴露。
//
// 新契约：客户端提供的 headers 照旧严格校验；服务端注入的凭据走独立通道
// （upstreamAuth），放行 authorization，但仍禁止劫持 host/cookie/proxy 等。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamRequest, isForbiddenHeader } from '../model-gateway/upstream.js';

test('客户端自带的 Authorization 依旧被拒绝（防凭据走私）', () => {
  assert.throws(
    () => buildUpstreamRequest({ headers: { Authorization: 'Bearer client-supplied' } }),
    /forbidden header/
  );
  assert.throws(
    () => buildUpstreamRequest({ headers: { Cookie: 'a=b' } }),
    /forbidden header/
  );
});

test('服务端注入的 Bearer 凭据放行，并落到 Authorization 头', () => {
  const built = buildUpstreamRequest({
    headers: { 'Content-Type': 'application/json' },
    upstreamAuth: { type: 'bearer', secret: 'sk-server-side' },
  });
  assert.equal(built.headers.Authorization, 'Bearer sk-server-side');
  assert.equal(built.headers['Content-Type'], 'application/json');
  // 注入的凭据不得混进客户端 headers 袋子（否则校验语义会被绕过）
  assert.equal(built.headers['upstreamAuth'], undefined);
});

test('服务端注入的自定义 Header 凭据放行', () => {
  const built = buildUpstreamRequest({
    headers: {},
    upstreamAuth: { type: 'header', headerName: 'X-Api-Key', secret: 'abc' },
  });
  assert.equal(built.headers['X-Api-Key'], 'abc');
});

test('注入的 header 名不得劫持 host/cookie/proxy/forwarded', () => {
  for (const headerName of ['Host', 'Cookie', 'Proxy-Authorization', 'X-Forwarded-For', 'Content-Length']) {
    assert.throws(
      () => buildUpstreamRequest({ headers: {}, upstreamAuth: { type: 'header', headerName, secret: 'x' } }),
      /forbidden header/,
      `injected ${headerName} must be rejected`
    );
  }
});

test('注入通道缺 header 名或空密钥时不静默放行', () => {
  assert.throws(() => buildUpstreamRequest({ headers: {}, upstreamAuth: { type: 'header', secret: 'x' } }), /header name/);
  assert.throws(() => buildUpstreamRequest({ headers: {}, upstreamAuth: { type: 'bearer', secret: '' } }), /secret/);
});

test('isForbiddenHeader 语义不变（authorization 仍属客户端禁用）', () => {
  assert.equal(isForbiddenHeader('authorization'), true);
  assert.equal(isForbiddenHeader('Content-Type'), false);
});

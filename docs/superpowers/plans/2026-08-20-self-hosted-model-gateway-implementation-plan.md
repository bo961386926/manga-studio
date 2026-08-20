# 自建文本、图片、视频模型网关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以服务端认证模型网关支持 OpenAI-compatible 的自建文本、图片、同步视频和异步视频模型，同时保留现有厂商适配器和 Stage 业务语义。

**Architecture:** 新增 Provider/Model/CredentialVersion/MediaAsset/Invocation/Job 数据层和固定协议 preset；客户端只发送 `modelId`、业务参数和 `Idempotency-Key`，服务端决定 URL、Header、凭证和上游超时。对现有 `geminiService.ts`、`services/adapters/*`、Stage 入口做最小接入，先通过 `modelService` 统一分流，再逐个替换直连点。

**Tech Stack:** TypeScript、Express/pg、Node fetch/AbortController、AES-256-GCM、HMAC、S3-compatible private object storage（首版可用受控本地对象存储适配器）、Vitest + Node tests。

---

## 文件责任地图

**Create**

- `server/migrations/003_model_gateway.sql`：providers、models、credential versions、media_assets、invocations、jobs、usage/audit。
- `server/model-gateway/crypto.js`：credential/result/request AEAD、key_id、AAD、rotation。
- `server/model-gateway/policy.js`：scope/access/VIP/operation/size/quota checks。
- `server/model-gateway/upstream.js`：DNS/IP binding、allowlist、manual redirects、timeouts、header blacklist。
- `server/model-gateway/presets.js`：四个固定 OpenAI-compatible wire presets。
- `server/model-gateway/gateway.js`：chat/image/video sync/async orchestration。
- `server/model-gateway/media.js`：MediaRef、upload/content/delete、quota/refcount。
- `server/routes/model-gateway.js`：invoke/jobs/media/admin CRUD/test routes。
- `server/test/model-gateway.test.js`、`server/test/upstream-security.test.js`。
- `services/modelGatewayClient.ts`：authenticated client DTOs and idempotency.
- `types/modelGateway.ts`：shared DTOs and error unions。

**Modify**

- `server/index.js`、`server/db.js`：mount authenticated routes and migrations。
- `types/model.ts`、`services/modelService.ts`、`services/adapters/index.ts`：add normalized provider/model/preset fields without deleting old fields。
- `services/geminiService.ts` and actual Stage entry points discovered by characterization tests：call gateway only for self-hosted models。
- `components/ModelConfig/*`、`components/ModelSelector.tsx`、`components/StageDirector/VideoGenerator.tsx`：CRUD, access badges, async polling/cancel, error states。
- `services/apiClient.ts`：credentials never accepted from browser; propagate AbortSignal and Idempotency-Key。
- `server/index.js`：delete `/api/ai-forward` only at final gate。

## Task 1: Freeze existing behavior with characterization tests

**Files:** create `tests/model-routing.characterization.test.ts`, `tests/video-cancel.characterization.test.ts`; modify only test seams in `services/modelService.ts` if needed.

- [ ] **Step 1: Write tests**

```ts
it('keeps the existing vendor model path unchanged', async () => {
  const result = await routeModel({ provider: 'gemini', modelId: 'gemini-2.0-flash' }, deps);
  expect(result.adapter).toBe('legacy-vendor');
});

it('does not silently resubmit an uncertain video job', async () => {
  await expect(reconcileSubmission({ status: 'submission_uncertain' }, deps)).resolves.toEqual({ action: 'query-or-manual' });
});
```

- [ ] **Step 2: Run to verify baseline**

Run: `pnpm test -- --run tests/model-routing.characterization.test.ts tests/video-cancel.characterization.test.ts`. Expected: tests expose current seams; record baseline before modification.

- [ ] **Step 3: Commit baseline tests**

```bash
git add tests/model-routing.characterization.test.ts tests/video-cancel.characterization.test.ts
git commit -m "test(model): capture existing vendor and video behavior"
```

## Task 2: Add normalized model schema and encrypted credentials

**Files:** create `server/migrations/003_model_gateway.sql`, `server/model-gateway/crypto.js`, `server/test/model-gateway.test.js`; modify `server/db.js`.

- [ ] **Step 1: Write schema/crypto tests**

```js
test('credential ciphertext is bound to owner, record, field and key id', async () => {
  const sealed = sealSecret('secret', { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' });
  assert.equal(openSecret(sealed, { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' }), 'secret');
  assert.throws(() => openSecret(sealed, { ownerId: 'u2', recordId: 'p1', field: 'api_key', keyId: 'v1' }));
});
```

- [ ] **Step 2: Implement schema**

Create Provider owner/scope, Model provider/capability/preset/access, credential version XOR provider/model, MediaAsset, Invocation (including `model_id_snapshot`, result `*_key_id`), and Job tables. Enforce private/shared ownership, auth-none null credential, composite user FKs, and unique `(user_id, operation, idempotency_key)`.

- [ ] **Step 3: Implement crypto**

Use AES-256-GCM with 96-bit CSPRNG nonce; store ciphertext/iv/tag/key_id; AAD includes table, record, owner, field, auth type and key id. Unknown key IDs and tag failures fail closed. Request hashes use deployment-secret HMAC, never raw SHA-256.

- [ ] **Step 4: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="ciphertext|schema"`. Commit:

```bash
git add server/migrations/003_model_gateway.sql server/model-gateway/crypto.js server/db.js server/test/model-gateway.test.js
git commit -m "feat(model-gateway): add owned model schema and key versioning"
```

## Task 3: Implement policy, presets, and hardened upstream transport

**Files:** create `server/model-gateway/policy.js`, `server/model-gateway/presets.js`, `server/model-gateway/upstream.js`, `server/test/upstream-security.test.js`.

- [ ] **Step 1: Write security tests**

```js
test('client target URL and dangerous headers are rejected', () => {
  assert.throws(() => buildUpstreamRequest({ targetUrl: 'https://evil.example', headers: { Host: 'x' } }), /forbidden/);
});

test('POST redirect is denied and private IP DNS binding is blocked', async () => {
  await assert.rejects(fetchUpstream({ url: 'https://public.example', method: 'POST' }), /redirect denied/);
  await assert.rejects(resolveAndBind('http://127.0.0.1'), /private address/);
});
```

- [ ] **Step 2: Implement fixed presets**

Support only `openai-chat`, `openai-image`, `openai-video-sync`, `openai-video-async`; no arbitrary templates/JSONPath. Validate exact request/response shapes, content limits, operation capability and 200/202 semantics.

- [ ] **Step 3: Implement transport security**

Resolve DNS and bind the validated address for the request; deny metadata/private ranges unless explicit server allowlist; manual redirects; deny `Host`, `Cookie`, `Authorization`, `Proxy-*`, hop-by-hop, `Content-Length`, `Forwarded`, `Via`, `X-Forwarded-*` and adapter-reserved headers. Enforce connect/headers/body timeouts, AbortSignal, response-size limits, and sanitized logs.

- [ ] **Step 4: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="target URL|dangerous|redirect|private"`. Commit:

```bash
git add server/model-gateway server/test/upstream-security.test.js
git commit -m "feat(model-gateway): enforce presets and upstream network policy"
```

## Task 4: Implement media assets and MediaRef boundary

**Files:** create `server/model-gateway/media.js`, `server/test/media.test.js`, `types/modelGateway.ts`; modify `services/apiClient.ts`.

- [ ] **Step 1: Write tests**

```js
test('media content requires owner and enforces size/type quota', async () => {
  assert.equal((await getMediaContent('u2', 'u1-asset')).status, 404);
  await assert.rejects(uploadMedia('u1', Buffer.alloc(50 * 1024 * 1024 + 1), 'image/png'), /size/);
});
```

- [ ] **Step 2: Implement**

Use canonical `MediaRef = { kind: 'media', id, contentType, sizeBytes }`; private object keys are namespaced by user; content API sets `Content-Disposition`, `X-Content-Type-Options: nosniff`, range limits and owner/job authorization. `ensureMediaRef()` uploads Data URL/local media before gateway; server never fetches arbitrary remote URLs.

- [ ] **Step 3: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="media"`; commit:

```bash
git add server/model-gateway/media.js server/test/media.test.js types/modelGateway.ts services/apiClient.ts
git commit -m "feat(model-gateway): add private media asset boundary"
```

## Task 5: Implement invocation, sync calls, and async jobs

**Files:** create `server/model-gateway/gateway.js`, `server/routes/model-gateway.js`, `server/test/invocation.test.js`; modify `server/index.js`.

- [ ] **Step 1: Write idempotency tests**

```js
test('same user/key/hash returns prior sync result without a second upstream call', async () => {
  const first = await invoke({ userId: 'u1', operation: 'chat', idempotencyKey: 'k1' });
  const second = await invoke({ userId: 'u1', operation: 'chat', idempotencyKey: 'k1' });
  assert.deepEqual(second, first);
  assert.equal(upstream.calls, 1);
});

test('same key with different request hash is rejected', async () => {
  await assert.rejects(invoke({ userId: 'u1', operation: 'chat', idempotencyKey: 'k1', prompt: 'other' }), /idempotency conflict/);
});
```

- [ ] **Step 2: Implement invocation lifecycle**

Create invocation before upstream call; require `Idempotency-Key`; persist encrypted request payload/key ID; store sync Chat/Test encrypted result with explicit result key IDs and `model_id_snapshot`; store image/video as MediaRef. On DB crash after upstream success, enter `submission_uncertain`; never auto-resubmit without safe upstream query/idempotency.

- [ ] **Step 3: Implement async job lifecycle**

Create one-to-one job with `submitting`, `submission_uncertain`, `queued`, `polling`, terminal states, lease and retry fields; snapshot auth credential version and model config without plaintext credentials; retain source MediaRefs until terminal cleanup. Cancellation must be idempotent.

- [ ] **Step 4: Add routes**

Implement `POST /api/model-invocations`, `GET /api/model-jobs/:id`, `POST /api/model-jobs/:id/cancel`, `POST /api/model-tests`, `POST /api/media-assets`, and media content/delete routes. Every lookup uses `(user_id,id)` and returns 404 for another user.

- [ ] **Step 5: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="idempotency|uncertain|job"`; commit:

```bash
git add server/model-gateway/gateway.js server/routes/model-gateway.js server/test/invocation.test.js server/index.js
git commit -m "feat(model-gateway): add authenticated invocation and job lifecycle"
```

## Task 6: Add Provider/Model admin UI and client DTOs

**Files:** create/modify `types/modelGateway.ts`, `services/modelGatewayClient.ts`, `components/ModelConfig/AddModelForm.tsx`, `components/ModelConfig/ModelCard.tsx`, `components/ModelConfig/ModelList.tsx`, `components/ModelSelector.tsx`.

- [ ] **Step 1: Write client tests**

```ts
it('sends modelId and idempotency key but never targetUrl or credential', async () => {
  await invokeChat({ modelId: 'm1', prompt: 'hi' }, fakeFetch);
  expect(fakeFetch.last.body).not.toContain('targetUrl');
  expect(fakeFetch.last.body).not.toContain('apiKey');
  expect(fakeFetch.last.headers['Idempotency-Key']).toBeTruthy();
});
```

- [ ] **Step 2: Implement DTOs/client**

Define `ChatInvokeV1`, `ImageInvokeV1`, `VideoInvokeV1`, `ChatResultV1`, `AssetResultV1`, `JobAcceptedV1` and typed error union. Propagate AbortSignal; generate stable idempotency key per user action/retry.

- [ ] **Step 3: Implement UI**

Private CRUD is user-scoped; shared CRUD admin-only; credentials show only `credentialConfigured`/masked metadata. Capability/access/VIP badges and model test action use server endpoints. Do not put raw credentials into React state after submission.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- --run` and `pnpm build`. Commit:

```bash
git add types/modelGateway.ts services/modelGatewayClient.ts components/ModelConfig components/ModelSelector.tsx
git commit -m "feat(model-gateway): add typed client and model administration UI"
```

## Task 7: Connect existing Stage entry points incrementally

**Files:** modify `services/modelService.ts`, `services/geminiService.ts`, `services/adapters/*`, `components/StageDirector/VideoGenerator.tsx`, and any direct call sites found by `rg "geminiService|proxyFetch|fetch\(" services components`.

- [ ] **Step 1: Add routing test per entry point**

```ts
it('routes self-hosted model to gateway and legacy provider to existing adapter', async () => {
  expect(await generateText({ modelId: 'self-hosted-1', prompt: 'x' })).toMatchObject({ source: 'gateway' });
  expect(await generateText({ modelId: 'gemini-2.0-flash', prompt: 'x' })).toMatchObject({ source: 'legacy' });
});
```

- [ ] **Step 2: Implement minimum routing seam**

Resolve model metadata once; branch only on normalized `adapter_kind`/capability. Keep vendor request bodies, retries, polling and returned project DTOs unchanged. Convert legacy image/video input to MediaRef at the gateway boundary; never change stored project JSON in this task except the documented compatibility DTO.

- [ ] **Step 3: Verify each stage**

Run targeted Vitest after text, image, sync video, async video separately. Expected: existing golden tests pass and new mock upstream tests cover each preset.

- [ ] **Step 4: Commit**

```bash
git add services components tests
git commit -m "feat(model-gateway): route stages without changing legacy semantics"
```

## Task 8: Remove unsafe proxy and harden Electron release

**Files:** modify `server/index.js`, `services/apiClient.ts`, `electron/main.cjs`, `nginx.conf`, `docker-compose.yaml`; create `server/test/no-unsafe-proxy.test.js`.

- [ ] **Step 1: Write final security test**

```js
test('production route table has no arbitrary forwarding endpoint', async () => {
  assert.equal((await request('/api/ai-forward', { method: 'POST', json: { targetUrl: 'https://example.com' } })).status, 404);
});
```

- [ ] **Step 2: Implement and verify**

Delete `/api/ai-forward`, reject `targetUrl`/upstream headers in all new DTOs, remove client `proxyFetch` use for model calls, close exposed Docker API port, and enforce exact HTTPS origin/CSP. Electron uses `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true`, `webSecurity:true`, no remote preload, and external links in system browser.

- [ ] **Step 3: Commit**

```bash
git add server/index.js services/apiClient.ts electron/main.cjs nginx.conf docker-compose.yaml server/test/no-unsafe-proxy.test.js
git commit -m "security(model-gateway): remove arbitrary proxy and harden electron"
```

## Task 9: Stage-3 acceptance and public-release gate

- [ ] Run `cd server && npm test`; run `pnpm test -- --run`; run `pnpm build`.
- [ ] Run controlled mock upstream tests for all four presets, including timeout, cancellation, redirect, private DNS, oversized response, malformed response and upstream 5xx.
- [ ] Verify credential rotation and result-key rotation; unknown key ID fails closed; model physical deletion still replays retained invocation via `model_id_snapshot`.
- [ ] Verify VIP access: free user receives 403 for VIP model, verified user can use free model, admin can grant/revoke/expire VIP.
- [ ] Verify usage/audit contains user/model/operation/status/latency but no prompt, output, credential, raw URL or token.
- [ ] Verify IDOR for models, jobs, media and invocation IDs returns 404.
- [ ] Verify production search returns no `targetUrl` acceptance and no `/api/ai-forward` route.
- [ ] Only after all checks pass, publish the remote HTTPS Web app and then the Electron release that points to it.


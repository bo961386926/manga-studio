import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_ASYNC_PRESETS, resolveImageAsyncPreset } from '../model-gateway/presets.js';

const cfg = { createEndpoint: '/v1/services/aigc/image2image/image-synthesis' };

test('dashscope image2image async preset contract', () => {
  const preset = resolveImageAsyncPreset('dashscope-image-async');
  assert.equal(preset.key, 'dashscope-image-async');
  assert.equal(preset.createPath(cfg), '/v1/services/aigc/image2image/image-synthesis');
  const built = preset.buildCreateRequest({
    apiModel: 'wanx2.1-i2i-turbo', prompt: '赛博朋克风格', size: '1024*1024',
    baseImageDataUrl: 'data:image/png;base64,AAAA',
  });
  assert.equal(built.jsonBody.model, 'wanx2.1-i2i-turbo');
  assert.equal(built.jsonBody.input.prompt, '赛博朋克风格');
  assert.equal(built.jsonBody.input.base_image_url, 'data:image/png;base64,AAAA');
  assert.equal(built.extraHeaders['X-DashScope-Async'], 'enable');
  assert.equal(preset.parseCreateResponse({ output: { task_id: 'task-9' } }).taskId, 'task-9');
  assert.equal(preset.statusPath('task-9', {}), '/v1/tasks/task-9');
  assert.equal(preset.classifyStatus({ output: { task_status: 'PENDING' } }), 'waiting');
  assert.equal(preset.classifyStatus({ output: { task_status: 'SUCCEEDED' } }), 'success');
  assert.equal(preset.classifyStatus({ output: { task_status: 'FAILED' } }), 'failure');
  assert.equal(preset.extractResult({ output: { results: [{ url: 'https://x/y.png' }] } }).resourceId, 'https://x/y.png');
  assert.throws(() => preset.extractResult({ output: { results: [] } }));
  assert.match(String(preset.extractError({ output: { message: 'quota' } })), /quota|failed/);
});

test('registry exposes image async and falls back to null', () => {
  assert.ok(IMAGE_ASYNC_PRESETS['dashscope-image-async']);
  assert.equal(resolveImageAsyncPreset('minimax-video-async'), undefined);
});

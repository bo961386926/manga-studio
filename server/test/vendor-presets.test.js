// Vendor async video presets: wire shapes ported from services/geminiService.ts
// (production-verified). These tests pin the request bodies, status
// classification and result extraction for each vendor protocol, plus the
// job-poll deps builder that routes use for poll-on-read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveVideoAsyncPreset,
  VIDEO_ASYNC_PRESETS,
} from '../model-gateway/presets.js';
import { buildJobPollDeps } from '../routes/model-gateway.js';

const baseArgs = {
  apiModel: 'vendor-video-1',
  prompt: 'a cat walks',
  size: '1280x720',
  aspectRatio: '16:9',
  duration: 8,
  startFrameDataUrl: undefined,
  endFrameDataUrl: undefined,
};

test('ark preset builds content-array request with resolution suffix', () => {
  const preset = VIDEO_ASYNC_PRESETS['ark-video-async'];
  const { jsonBody, extraHeaders } = preset.buildCreateRequest({ ...baseArgs });
  assert.equal(jsonBody.model, 'vendor-video-1');
  assert.equal(jsonBody.content[0].type, 'text');
  assert.match(jsonBody.content[0].text, / --resolution 720p --duration 8$/);
  assert.equal(extraHeaders['X-DashScope-Async'], undefined);

  const portrait = preset.buildCreateRequest({ ...baseArgs, aspectRatio: '9:16' });
  assert.match(portrait.jsonBody.content[0].text, / --resolution 720p-portrait /);

  const withFrame = preset.buildCreateRequest({ ...baseArgs, startFrameDataUrl: 'data:image/png;base64,AAA' });
  assert.equal(withFrame.jsonBody.content[1].type, 'image_url');
  assert.equal(withFrame.jsonBody.content[1].image_url.url, 'data:image/png;base64,AAA');
});

test('ark preset classifies status and extracts video url', () => {
  const preset = VIDEO_ASYNC_PRESETS['ark-video-async'];
  assert.equal(preset.parseCreateResponse({ id: 'cgt-1' }).taskId, 'cgt-1');
  assert.throws(() => preset.parseCreateResponse({}));
  assert.equal(preset.statusPath('cgt-1', {}), '/contents/generations/tasks/cgt-1');
  assert.equal(preset.classifyStatus({ status: 'succeeded' }), 'success');
  assert.equal(preset.classifyStatus({ status: 'queued' }), 'waiting');
  assert.equal(preset.classifyStatus({ status: 'FAILED' }), 'failure');
  assert.equal(
    preset.extractResult({ content: { video_url: 'https://cdn/v.mp4' } }).resourceId,
    'https://cdn/v.mp4'
  );
  assert.throws(() => preset.extractResult({ content: {} }));
  assert.equal(preset.extractError({ error: { message: 'bad prompt' } }), 'bad prompt');
});

test('dashscope preset sends async header and parses output.task_id', () => {
  const preset = VIDEO_ASYNC_PRESETS['dashscope-video-async'];
  const { jsonBody, extraHeaders } = preset.buildCreateRequest({
    ...baseArgs,
    startFrameDataUrl: 'data:image/png;base64,AAA',
  });
  assert.equal(extraHeaders['X-DashScope-Async'], 'enable');
  assert.equal(jsonBody.input.first_frame_image, 'data:image/png;base64,AAA');
  assert.equal(jsonBody.parameters.size, '1280x720');
  assert.equal(jsonBody.parameters.duration, 8);

  assert.equal(preset.parseCreateResponse({ output: { task_id: 't-9' } }).taskId, 't-9');
  assert.equal(
    preset.statusPath('t-9', {}),
    '/v1/services/aigc/video-generation/video-synthesis/t-9'
  );
  assert.equal(preset.classifyStatus({ output: { task_status: 'SUCCEEDED' } }), 'success');
  assert.equal(preset.classifyStatus({ output: { task_status: 'RUNNING' } }), 'waiting');
  assert.equal(preset.classifyStatus({ output: { task_status: 'FAILED' } }), 'failure');
  assert.equal(
    preset.extractResult({ output: { video_url: 'https://cdn/v.mp4' } }).resourceId,
    'https://cdn/v.mp4'
  );
  assert.equal(preset.extractError({ output: { message: 'quota' } }), 'quota');
});

test('minimax preset posts to v2 path with adaptive ratio on frames', () => {
  const preset = VIDEO_ASYNC_PRESETS['minimax-video-async'];
  const textOnly = preset.buildCreateRequest(baseArgs);
  assert.equal(textOnly.jsonBody.ratio, '16:9');
  assert.equal(textOnly.jsonBody.resolution, '768P');
  assert.equal(textOnly.jsonBody.aigc_watermark, false);

  const withFrame = preset.buildCreateRequest({ ...baseArgs, startFrameDataUrl: 'data:image/png;base64,AAA' });
  assert.equal(withFrame.jsonBody.ratio, 'adaptive');
  assert.equal(withFrame.jsonBody.content[1].role, 'first_frame');

  assert.equal(preset.parseCreateResponse({ task_id: 'm-1' }).taskId, 'm-1');
  assert.equal(preset.statusPath('m-1'), '/query/video_generation/m-1');
  assert.equal(preset.classifyStatus({ task: { status: 'succeeded' } }), 'success');
  assert.equal(preset.classifyStatus({ task: { status: 'Queueing' } }), 'waiting');
  assert.equal(preset.classifyStatus({ task: { status: 'expired' } }), 'failure');
  assert.equal(preset.extractResult({ task: { content: { url: 'https://cdn/m.mp4' } } }).resourceId, 'https://cdn/m.mp4');
  assert.equal(preset.extractError({ task: { error: 'content blocked' } }), 'content blocked');
});

test('openai preset maps unknown statuses to waiting and resolver falls back', () => {
  const preset = resolveVideoAsyncPreset('something-new');
  assert.equal(preset.key, 'openai-video-async');
  assert.equal(preset.classifyStatus({ status: 'brand-new-status' }), 'waiting');
  assert.equal(
    resolveVideoAsyncPreset('minimax-video-async').key,
    'minimax-video-async'
  );
});

test('buildJobPollDeps polls via preset status path and downloads results', async () => {
  const captured = {};
  const model = {
    id: 'm1',
    api_model: 'doubao-video',
    protocol_preset: 'ark-video-async',
    endpoint_path: '/contents/generations/tasks',
    protocol_config: {},
    timeout_ms: 0,
    auth_override_type: null,
    provider: {
      id: 'p1',
      base_url: 'https://ark.example',
      auth_type: 'none',
      timeout_ms: 0,
      credential: null,
    },
  };
  const deps = buildJobPollDeps({
    model,
    callerDeps: {
      fetchUpstream: async (opts) => {
        captured.status = opts;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://cdn/v.mp4' } })),
        };
      },
      downloadUpstream: async (opts) => {
        captured.download = opts;
        return { status: 200, headers: { 'content-type': 'video/mp4' }, body: Buffer.from('VIDEOBYTES') };
      },
    },
  });

  const upstream = await deps.fetchJobStatus({ taskId: 'cgt-77' });
  assert.equal(captured.status.url, 'https://ark.example/contents/generations/tasks/cgt-77');
  assert.equal(captured.status.method, 'GET');
  assert.equal(upstream.state, 'success');
  assert.equal(upstream.resourceId, 'https://cdn/v.mp4');

  const media = await deps.downloadJobResult({ resourceId: 'https://cdn/v.mp4' });
  assert.equal(captured.download.url, 'https://cdn/v.mp4');
  assert.equal(media.contentType, 'video/mp4');
  assert.equal(media.buffer.toString('utf8'), 'VIDEOBYTES');
});

test('buildJobPollDeps reports failure state with vendor error message', async () => {
  const model = {
    id: 'm1',
    api_model: 'qwen-video',
    protocol_preset: 'dashscope-video-async',
    endpoint_path: '/v1/services/aigc/video-generation/video-synthesis',
    protocol_config: {},
    timeout_ms: 0,
    auth_override_type: null,
    provider: { id: 'p1', base_url: 'https://dash.example', auth_type: 'none', timeout_ms: 0, credential: null },
  };
  const deps = buildJobPollDeps({
    model,
    callerDeps: {
      fetchUpstream: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ output: { task_status: 'FAILED', message: 'content policy' } })),
      }),
    },
  });
  const upstream = await deps.fetchJobStatus({ taskId: 't-1' });
  assert.equal(upstream.state, 'failure');
  assert.equal(upstream.error, 'content policy');
});

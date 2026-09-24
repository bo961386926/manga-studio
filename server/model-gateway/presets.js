// Fixed wire presets for self-hosted models. No arbitrary templates/JSONPath:
// openai-chat / openai-image / openai-video-sync / openai-video-async plus the
// vendor async video presets ported from services/geminiService.ts
// (production-verified wire shapes), with strict request shapes and response
// validation.
// Design source: self-hosted-cloud-models-design.md §8.

export const PRESETS = [
  'openai-chat',
  'openai-image',
  'openai-video-sync',
  'openai-video-async',
  'ark-video-async',
  'dashscope-video-async',
  'minimax-video-async',
];

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const assertString = (value, label) => {
  if (typeof value !== 'string') throw new ProtocolError(`${label} must be a string`);
  return value;
};

// ---------- openai-chat ----------

export const buildChatRequest = ({ apiModel, prompt, systemPrompt, responseFormat, supportsJson }) => {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const request = {
    model: apiModel,
    messages,
    temperature: 0.7,
    max_tokens: 8192,
    stream: false,
  };
  if (supportsJson && responseFormat === 'json') {
    request.response_format = { type: 'json_object' };
  }
  return request;
};

export const parseChatResponse = (body) => {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ProtocolError('missing choices[0].message.content');
  return content;
};

// ---------- openai-image ----------

export const buildImageRequest = ({ apiModel, prompt, size, responseFormat, referenceImages = [] }) => {
  if (referenceImages.length > 0) {
    // Multipart edit request: model/prompt/size/response_format + repeated image.
    const form = new FormData();
    form.append('model', apiModel);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('response_format', responseFormat);
    for (const img of referenceImages) {
      form.append('image', new Blob([img.buffer], { type: img.contentType }), `ref-${img.name || Date.now()}`);
    }
    return { kind: 'multipart', body: form };
  }
  return {
    kind: 'json',
    body: { model: apiModel, prompt, size, n: 1, response_format: responseFormat },
  };
};

export const parseImageResponse = (body, contentType, rawBuffer) => {
  if (contentType?.startsWith('image/')) return rawBuffer;
  const url = body?.data?.[0]?.b64_json
    ? null
    : body?.data?.[0]?.url || body?.output?.[0]?.url;
  if (typeof url === 'string') return { remoteUrl: url };
  if (typeof body?.data?.[0]?.b64_json === 'string') return { base64: body.data[0].b64_json };
  throw new ProtocolError('image response missing data/url');
};

// ---------- openai-video-sync ----------

export const buildVideoRequest = ({ apiModel, prompt, size, duration, startFrameUrl, endFrameUrl, supportsFrames }) => {
  const request = { model: apiModel, prompt, size, duration };
  if (supportsFrames && startFrameUrl) request.image_url = startFrameUrl;
  if (supportsFrames && endFrameUrl) request.end_image_url = endFrameUrl;
  return request;
};

export const parseVideoSyncResponse = (body, contentType, rawBuffer) => {
  if (contentType?.startsWith('video/')) return rawBuffer;
  const url = body?.data?.[0]?.url || body?.url || body?.video_url;
  if (typeof url === 'string') return { remoteUrl: url };
  if (typeof body?.data?.[0]?.b64_json === 'string') return { base64: body.data[0].b64_json };
  throw new ProtocolError('video response missing url/data');
};

// ---------- openai-video-async ----------

export const buildVideoCreateRequest = buildVideoRequest;

const WAITING_STATUSES = ['queued', 'pending', 'processing', 'running'];
const SUCCESS_STATUSES = ['completed', 'succeeded'];
const FAILURE_STATUSES = ['failed', 'error', 'cancelled'];

export const parseVideoCreateResponse = (body) => {
  const taskId = body?.id || body?.task_id;
  if (typeof taskId !== 'string' || !taskId) throw new ProtocolError('create response missing id/task_id');
  return { taskId };
};

export const classifyVideoStatus = (body) => {
  const status = assertString(body?.status, 'status');
  if (WAITING_STATUSES.includes(status)) return 'waiting';
  if (SUCCESS_STATUSES.includes(status)) return 'success';
  if (FAILURE_STATUSES.includes(status)) return 'failure';
  throw new ProtocolError(`unknown video status: ${status}`);
};

export const extractVideoResult = (body) => {
  const candidates = [
    body?.url,
    body?.video_url,
    body?.download_url,
    body?.output?.url,
    body?.video_id,
    body?.output?.id,
    body?.id,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v);
  if (!found) throw new ProtocolError('result missing url/video_id');
  return { resourceId: found };
};

export const extractVideoError = (body) => {
  const msg = body?.error?.message || body?.message || body?.error;
  return typeof msg === 'string' ? msg : 'upstream error';
};

// ---------- vendor async video presets ----------
// Uniform shape so the routes and the job poller can treat every async video
// preset identically:
//   createPath(protocolConfig, model)                → upstream POST path
//   buildCreateRequest({...})                        → { jsonBody, extraHeaders }
//   parseCreateResponse(body)                        → { taskId }
//   statusPath(taskId, protocolConfig, model)        → upstream GET path
//   classifyStatus(body)                             → 'waiting'|'success'|'failure'
//   extractResult(body)                              → { resourceId } (video URL)
//   extractError(body)                               → string
// Frames travel as data URLs / public URLs — media asset content is turned
// into a data URL by the routes layer before buildCreateRequest is called.

const statusOf = (...paths) => {
  for (const path of paths) {
    const value = path;
    if (typeof value === 'string' && value) return value.toLowerCase();
  }
  return '';
};

const ArkVideoAsync = {
  key: 'ark-video-async',
  createPath: (protocolConfig) => protocolConfig?.createEndpoint || '/contents/generations/tasks',
  buildCreateRequest: ({ apiModel, prompt, aspectRatio, duration, startFrameDataUrl, endFrameDataUrl }) => {
    void endFrameDataUrl; // ark first-frame-only in this flow
    const suffix = aspectRatio === '9:16'
      ? ` --resolution 720p-portrait --duration ${duration}`
      : ` --resolution 720p --duration ${duration}`;
    const content = [{ type: 'text', text: `${prompt}${suffix}` }];
    if (startFrameDataUrl) content.push({ type: 'image_url', image_url: { url: startFrameDataUrl } });
    return { jsonBody: { model: apiModel, content }, extraHeaders: {} };
  },
  parseCreateResponse: (body) => {
    const taskId = body?.id || body?.task_id || body?.data?.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new ProtocolError('ark create response missing id/task_id');
    return { taskId };
  },
  statusPath: (taskId, protocolConfig) =>
    `${protocolConfig?.createEndpoint || '/contents/generations/tasks'}/${taskId}`,
  classifyStatus: (body) => {
    const status = statusOf(body?.status, body?.data?.status, body?.output?.task_status);
    if (['succeeded', 'completed', 'done'].includes(status)) return 'success';
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failure';
    return 'waiting';
  },
  extractResult: (body) => {
    const url = body?.content?.video_url || body?.video_url || body?.url || body?.data?.video_url || body?.output?.video_url;
    if (typeof url !== 'string' || !url) throw new ProtocolError('ark result missing video url');
    return { resourceId: url };
  },
  extractError: (body) => body?.error?.message || body?.message || 'ark video generation failed',
};

const DashscopeVideoAsync = {
  key: 'dashscope-video-async',
  createPath: (protocolConfig) =>
    protocolConfig?.createEndpoint || '/v1/services/aigc/video-generation/video-synthesis',
  buildCreateRequest: ({ apiModel, prompt, size, duration, startFrameDataUrl, endFrameDataUrl }) => {
    void endFrameDataUrl; // dashscope first-frame-only in this flow
    const input = { prompt };
    if (startFrameDataUrl) input.first_frame_image = startFrameDataUrl;
    return {
      jsonBody: { model: apiModel, input, parameters: { size, duration } },
      extraHeaders: { 'X-DashScope-Async': 'enable' },
    };
  },
  parseCreateResponse: (body) => {
    const taskId = body?.output?.task_id || body?.task_id || body?.id;
    if (typeof taskId !== 'string' || !taskId) throw new ProtocolError('dashscope create response missing output.task_id');
    return { taskId };
  },
  statusPath: (taskId, protocolConfig) =>
    `${protocolConfig?.createEndpoint || '/v1/services/aigc/video-generation/video-synthesis'}/${taskId}`,
  classifyStatus: (body) => {
    const status = statusOf(body?.output?.task_status, body?.status);
    if (['succeeded', 'completed'].includes(status)) return 'success';
    if (['failed', 'error', 'canceled', 'cancelled', 'unknown'].includes(status)) return 'failure';
    return 'waiting';
  },
  extractResult: (body) => {
    const url = body?.output?.video_url || body?.output?.results?.video_url;
    if (typeof url !== 'string' || !url) throw new ProtocolError('dashscope result missing video url');
    return { resourceId: url };
  },
  extractError: (body) => body?.output?.message || body?.message || 'dashscope video generation failed',
};

const MinimaxVideoAsync = {
  key: 'minimax-video-async',
  // Requires the provider/model base URL to point at the /v2 API root
  // (e.g. https://api.minimaxi.com/v2); the v1→v2 rewrite of the legacy
  // client is intentionally not reproduced here.
  createPath: () => '/video_generation',
  buildCreateRequest: ({ apiModel, prompt, aspectRatio, duration, startFrameDataUrl, endFrameDataUrl }) => {
    void endFrameDataUrl; // first-frame-only in this flow
    const content = [{ type: 'text', text: prompt }];
    if (startFrameDataUrl) {
      content.push({ type: 'image_url', role: 'first_frame', image_url: { url: startFrameDataUrl } });
    }
    return {
      jsonBody: {
        model: apiModel,
        content,
        ratio: startFrameDataUrl ? 'adaptive' : aspectRatio,
        duration,
        resolution: '768P',
        aigc_watermark: false,
      },
      extraHeaders: {},
    };
  },
  parseCreateResponse: (body) => {
    const taskId = body?.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new ProtocolError('minimax create response missing task_id');
    return { taskId };
  },
  statusPath: (taskId) => `/query/video_generation/${taskId}`,
  classifyStatus: (body) => {
    const status = statusOf(body?.task?.status);
    if (status === 'succeeded') return 'success';
    if (['failed', 'expired'].includes(status)) return 'failure';
    return 'waiting';
  },
  extractResult: (body) => {
    const url = body?.task?.content?.url;
    if (typeof url !== 'string' || !url) throw new ProtocolError('minimax result missing task.content.url');
    return { resourceId: url };
  },
  extractError: (body) => {
    const task = body?.task;
    const msg = typeof task?.error === 'string' ? task.error : task?.error?.message || task?.message;
    return msg || 'minimax video generation failed';
  },
};

const OpenAIVideoAsync = {
  key: 'openai-video-async',
  createPath: (protocolConfig, model) => protocolConfig?.createEndpoint || model?.endpoint_path || '/videos',
  buildCreateRequest: ({ apiModel, prompt, size, duration, startFrameDataUrl, endFrameDataUrl }) => {
    const jsonBody = { model: apiModel, prompt, size, duration };
    if (startFrameDataUrl) jsonBody.image_url = startFrameDataUrl;
    if (endFrameDataUrl) jsonBody.end_image_url = endFrameDataUrl;
    return { jsonBody, extraHeaders: {} };
  },
  parseCreateResponse: parseVideoCreateResponse,
  statusPath: (taskId, protocolConfig, model) =>
    `${protocolConfig?.statusEndpoint || OpenAIVideoAsync.createPath(protocolConfig, model)}/${taskId}`,
  // Unknown status strings stay "waiting": pollJob treats anything else as a
  // terminal success, so a novel vendor status must never end a job early.
  classifyStatus: (body) => {
    const status = statusOf(body?.status);
    if (SUCCESS_STATUSES.includes(status)) return 'success';
    if (FAILURE_STATUSES.includes(status)) return 'failure';
    return 'waiting';
  },
  extractResult: (body) => {
    const candidates = [
      body?.url,
      body?.video_url,
      body?.download_url,
      body?.output?.url,
      body?.output?.video_url,
    ];
    const found = candidates.find((v) => typeof v === 'string' && v);
    if (!found) throw new ProtocolError('openai video result missing url');
    return { resourceId: found };
  },
  extractError: extractVideoError,
};

export const VIDEO_ASYNC_PRESETS = {
  'openai-video-async': OpenAIVideoAsync,
  'ark-video-async': ArkVideoAsync,
  'dashscope-video-async': DashscopeVideoAsync,
  'minimax-video-async': MinimaxVideoAsync,
};

export const resolveVideoAsyncPreset = (protocolPreset) =>
  VIDEO_ASYNC_PRESETS[protocolPreset] || OpenAIVideoAsync;

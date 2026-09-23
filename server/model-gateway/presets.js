// Fixed wire presets for self-hosted models. No arbitrary templates/JSONPath:
// exactly openai-chat / openai-image / openai-video-sync / openai-video-async,
// with strict request shapes and response validation.
// Design source: self-hosted-cloud-models-design.md §8.

export const PRESETS = ['openai-chat', 'openai-image', 'openai-video-sync', 'openai-video-async'];

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

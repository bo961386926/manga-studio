// Author: forsearch | Updated: 2026-04-30
import {
  ChatOptions,
  ImageGenerateOptions,
  VideoGenerateOptions,
  AspectRatio,
  VideoDuration,
} from '../types/model';

import { callChatApi, verifyApiKey as verifyChatApiKey, ApiKeyError } from './adapters/chatAdapter';
import { callImageApi } from './adapters/imageAdapter';
import { callVideoApi } from './adapters/videoAdapter';
import {
  getGlobalApiKey,
  getActiveVideoModel,
  getActiveChatModel,
  getActiveImageModel,
} from './modelRegistry';
import { setGlobalApiKey as setGeminiApiKey } from './geminiService';
import { invokeChat, invokeImage, invokeVideo, makeIdempotencyKey } from './modelGatewayClient';
import type { JobAcceptedV1 } from '../types/modelGateway';

export { ApiKeyError };

// ---------- gateway routing seam ----------

// Current behavior: every model routes through the legacy vendor adapters.
// Models marked adapter_kind === 'gateway' (managed in the server gateway UI)
// route to the authenticated gateway instead. This is the ONLY branch point;
// legacy request bodies, retries and return shapes stay untouched.
export const routeModel = async (
  input: RouteModelInput,
  _deps: unknown = {}
): Promise<{ adapter: string }> => {
  const { getModelById } = await import('./modelRegistry');
  const model = getModelById(input.modelId);
  if (model?.adapter_kind === 'gateway') {
    return { adapter: 'gateway' };
  }
  return { adapter: 'legacy-vendor' };
};

const gatewayModelFor = (type: 'chat' | 'image' | 'video') => {
  const getter = type === 'chat' ? getActiveChatModel : type === 'image' ? getActiveImageModel : getActiveVideoModel;
  const model = getter();
  return model?.adapter_kind === 'gateway' ? model : null;
};

export const chat = async (options: ChatOptions): Promise<string> => {
  const gw = gatewayModelFor('chat');
  if (gw) {
    const result = await invokeChat(
      gw.id,
      { prompt: options.prompt, systemPrompt: options.systemPrompt, responseFormat: options.responseFormat },
      makeIdempotencyKey('chat'),
      { signal: (options as any).signal }
    );
    return result.content;
  }
  return callChatApi(options);
};

export const chatJson = async (options: Omit<ChatOptions, 'responseFormat'>): Promise<string> => {
  const gw = gatewayModelFor('chat');
  if (gw) {
    const result = await invokeChat(
      gw.id,
      { prompt: options.prompt, systemPrompt: options.systemPrompt, responseFormat: 'json' },
      makeIdempotencyKey('chat-json'),
      { signal: (options as any).signal }
    );
    return result.content;
  }
  return callChatApi({ ...options, responseFormat: 'json' });
};

export const generateImage = async (options: ImageGenerateOptions): Promise<string> => {
  const gw = gatewayModelFor('image');
  if (gw) {
    const result = await invokeImage(
      gw.id,
      { prompt: options.prompt, aspectRatio: (options.aspectRatio || '16:9') as any, referenceAssetIds: options.referenceImages },
      makeIdempotencyKey('image'),
      { signal: (options as any).signal }
    );
    // Asset result: fetch bytes through the authenticated content API.
    const contentRes = await fetch(`/api/model-invocations/media-assets/${result.assetId}/content`);
    if (!contentRes.ok) throw new Error(`媒体获取失败 (${contentRes.status})`);
    const blob = await contentRes.blob();
    return await blobToDataUrl(blob);
  }
  return callImageApi(options);
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export const generateVideo = async (options: VideoGenerateOptions): Promise<string> => {
  const gw = gatewayModelFor('video');
  if (gw) {
    throw new Error('网关视频模型需通过异步任务调用：generateVideoGatewayJob');
  }
  return callVideoApi(options);
};

// Async video via the gateway: returns an accepted job to poll.
export const generateVideoGatewayJob = async (
  options: VideoGenerateOptions
): Promise<JobAcceptedV1> => {
  const gw = gatewayModelFor('video');
  if (!gw) throw new Error('当前未激活网关视频模型');
  return invokeVideo(
    gw.id,
    {
      prompt: options.prompt,
      aspectRatio: (options.aspectRatio || '16:9') as any,
      duration: (options as any).duration ?? 8,
    },
    makeIdempotencyKey('video'),
    { signal: (options as any).signal }
  );
};

// Poll a gateway video job to completion and return the video as a Data URL.
// Never auto-resubmits; a submission_uncertain job requires human action.
export const generateVideoWithPolling = async (
  options: VideoGenerateOptions,
  opts: { intervalMs?: number; maxWaitMs?: number; onStatus?: (status: string) => void } = {}
): Promise<string> => {
  const { getJob } = await import('./modelGatewayClient');
  const job = await generateVideoGatewayJob(options);
  const intervalMs = opts.intervalMs ?? 5000;
  const deadline = Date.now() + (opts.maxWaitMs ?? 20 * 60 * 1000);
  for (;;) {
    const state = await getJob(job.jobId);
    opts.onStatus?.(state.status);
    if (state.status === 'succeeded' && state.resultAssetId) {
      const contentRes = await fetch(`/api/model-invocations/media-assets/${state.resultAssetId}/content`);
      if (!contentRes.ok) throw new Error(`视频获取失败 (${contentRes.status})`);
      const blob = await contentRes.blob();
      return blobToDataUrl(blob);
    }
    if (state.status === 'submission_uncertain') {
      throw new Error('视频提交状态不确定，请稍后手动查询，不会自动重试以避免重复计费');
    }
    if (['failed', 'cancelled', 'expired'].includes(state.status)) {
      throw new Error(`视频任务${state.status}：${state.errorMessage || ''}`);
    }
    if (Date.now() > deadline) throw new Error('视频生成超时');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

export const parseScript = async (options: {
  rawText: string;
  language: string;
  visualStyle: string;
}): Promise<any> => {
  const prompt = buildScriptParsePrompt(options.rawText, options.language, options.visualStyle);
  const result = await chatJson({ prompt, timeout: 600000 });
  return JSON.parse(result);
};

export const generateShots = async (options: {
  scriptData: any;
}): Promise<any[]> => {
  const prompt = buildShotGenerationPrompt(options.scriptData);
  const result = await chatJson({ prompt, timeout: 600000 });
  const parsed = JSON.parse(result);
  return parsed.shots || [];
};

export const generateVisualPrompts = async (options: {
  type: 'character' | 'scene';
  data: any;
  genre: string;
  visualStyle: string;
  language: string;
}): Promise<{ visualPrompt: string; negativePrompt: string }> => {
  const prompt = buildVisualPromptGenerationPrompt(options);
  const result = await chatJson({ prompt });
  return JSON.parse(result);
};

export const optimizeKeyframePrompt = async (options: {
  frameType: 'start' | 'end';
  actionSummary: string;
  cameraMovement: string;
  sceneInfo: string;
  characterInfo: string;
  visualStyle: string;
}): Promise<string> => {
  const prompt = buildKeyframeOptimizationPrompt(options);
  return chat({ prompt });
};

export const generateActionSuggestion = async (options: {
  startFramePrompt: string;
  endFramePrompt: string;
  cameraMovement: string;
}): Promise<string> => {
  const prompt = buildActionSuggestionPrompt(options);
  return chat({ prompt });
};

export const splitShot = async (options: {
  shot: any;
  sceneInfo: string;
  characterNames: string[];
  visualStyle: string;
}): Promise<{ subShots: any[] }> => {
  const prompt = buildShotSplitPrompt(options);
  const result = await chatJson({ prompt });
  return JSON.parse(result);
};

export const verifyApiKey = async (apiKey: string): Promise<{ success: boolean; message: string }> => {
  return verifyChatApiKey(apiKey);
};

export const getApiKey = (): string | undefined => {
  return getGlobalApiKey();
};

export const setApiKey = (apiKey: string): void => {
  setGeminiApiKey(apiKey);
};

export const getVideoModelCapabilities = (): {
  supportedAspectRatios: AspectRatio[];
  supportedDurations: VideoDuration[];
  defaultAspectRatio: AspectRatio;
  defaultDuration: VideoDuration;
} => {
  const model = getActiveVideoModel();
  if (!model) {
    return {
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      supportedDurations: [4, 8, 12],
      defaultAspectRatio: '16:9',
      defaultDuration: 8,
    };
  }
  
  return {
    supportedAspectRatios: model.params.supportedAspectRatios,
    supportedDurations: model.params.supportedDurations,
    defaultAspectRatio: model.params.defaultAspectRatio,
    defaultDuration: model.params.defaultDuration,
  };
};

function buildScriptParsePrompt(rawText: string, language: string, visualStyle: string): string {
  return `You are a professional screenwriter assistant. Parse the following script/story into structured data.

Script Text:
${rawText}

Requirements:
- Language: ${language}
- Visual Style: ${visualStyle}
- Extract: title, genre, logline, characters (with name, gender, age, personality), scenes (with location, time, atmosphere)
- Generate story paragraphs with scene references

Return a valid JSON object with the structure:
{
  "title": "string",
  "genre": "string", 
  "logline": "string",
  "characters": [{"id": "string", "name": "string", "gender": "string", "age": "string", "personality": "string", "variations": []}],
  "scenes": [{"id": "string", "location": "string", "time": "string", "atmosphere": "string"}],
  "storyParagraphs": [{"id": number, "text": "string", "sceneRefId": "string"}]
}`;
}

function buildShotGenerationPrompt(scriptData: any): string {
  return `You are a professional film director. Generate a shot list for the following script.

Script Data:
${JSON.stringify(scriptData, null, 2)}

Generate detailed shots with:
- sceneId: reference to scene
- actionSummary: what happens in the shot
- dialogue: any spoken lines
- cameraMovement: camera direction
- shotSize: shot type (wide, medium, close-up, etc.)
- characters: array of character IDs in the shot

Return a valid JSON object:
{
  "shots": [
    {
      "id": "string",
      "sceneId": "string",
      "actionSummary": "string",
      "dialogue": "string",
      "cameraMovement": "string",
      "shotSize": "string",
      "characters": ["string"],
      "keyframes": []
    }
  ]
}`;
}

function buildVisualPromptGenerationPrompt(options: {
  type: 'character' | 'scene';
  data: any;
  genre: string;
  visualStyle: string;
  language: string;
}): string {
  const { type, data, genre, visualStyle, language } = options;
  
  if (type === 'character') {
    return `Generate a detailed visual prompt for this character:
Name: ${data.name}
Gender: ${data.gender}
Age: ${data.age}
Personality: ${data.personality}

Genre: ${genre}
Visual Style: ${visualStyle}
Language: ${language}

Return JSON:
{
  "visualPrompt": "detailed description for image generation",
  "negativePrompt": "elements to avoid"
}`;
  } else {
    return `Generate a detailed visual prompt for this scene:
Location: ${data.location}
Time: ${data.time}
Atmosphere: ${data.atmosphere}

Genre: ${genre}
Visual Style: ${visualStyle}
Language: ${language}

Return JSON:
{
  "visualPrompt": "detailed description for image generation",
  "negativePrompt": "elements to avoid"
}`;
  }
}

function buildKeyframeOptimizationPrompt(options: {
  frameType: 'start' | 'end';
  actionSummary: string;
  cameraMovement: string;
  sceneInfo: string;
  characterInfo: string;
  visualStyle: string;
}): string {
  return `Optimize this keyframe prompt for ${options.frameType} frame:

Action: ${options.actionSummary}
Camera: ${options.cameraMovement}
Scene: ${options.sceneInfo}
Characters: ${options.characterInfo}
Visual Style: ${options.visualStyle}

Generate a detailed, cinematic prompt for image generation. Return only the prompt text.`;
}

function buildActionSuggestionPrompt(options: {
  startFramePrompt: string;
  endFramePrompt: string;
  cameraMovement: string;
}): string {
  return `Suggest an action description connecting these keyframes:

Start Frame: ${options.startFramePrompt}
End Frame: ${options.endFramePrompt}
Camera Movement: ${options.cameraMovement}

Generate a concise action summary describing the transition. Return only the action text.`;
}

function buildShotSplitPrompt(options: {
  shot: any;
  sceneInfo: string;
  characterNames: string[];
  visualStyle: string;
}): string {
  return `Split this shot into multiple sub-shots:

Shot: ${JSON.stringify(options.shot)}
Scene: ${options.sceneInfo}
Characters: ${options.characterNames.join(', ')}
Visual Style: ${options.visualStyle}

Return JSON:
{
  "subShots": [
    {
      "actionSummary": "string",
      "cameraMovement": "string",
      "characters": ["string"]
    }
  ]
}`;
}

// ============================================
// Characterization test seams (stage-3 gateway routing)
// ============================================
// These seams freeze CURRENT behavior so the self-hosted model gateway can
// branch on normalized adapter_kind without changing legacy vendor semantics.
// Do not change their current return values unless the legacy path itself
// changes first.

export interface RouteModelInput {
  provider: string;
  modelId: string;
}

export type SubmissionState =
  | 'submitting'
  | 'submission_uncertain'
  | 'queued'
  | 'polling'
  | 'done'
  | 'failed';

// There is no server-side job store today; the caller owns retries. A
// submission whose result is unknown must never be silently resubmitted —
// the gateway must either query upstream safely or hand off to a human.
export const reconcileSubmission = async (
  state: { status: SubmissionState },
  _deps: unknown = {}
): Promise<{ action: string }> => {
  if (state.status === 'submission_uncertain') {
    return { action: 'query-or-manual' };
  }
  return { action: 'none' };
};

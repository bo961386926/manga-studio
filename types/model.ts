export type ModelType = 'chat' | 'image' | 'video';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = 4 | 8 | 12;

export type VideoMode = 'sync' | 'async' | 'doubao' | 'qwen';

export interface ChatModelParams {
  temperature: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface ImageModelParams {
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
}

export interface VideoModelParams {
  mode: VideoMode;
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  defaultDuration: VideoDuration;
  supportedDurations: VideoDuration[];
}

export type ModelParams = ChatModelParams | ImageModelParams | VideoModelParams;

export interface ModelDefinitionBase {
  id: string;
  apiModel?: string;
  name: string;
  type: ModelType;
  providerId: string;
  endpoint?: string;
  description?: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  apiKey?: string;
}

export interface ChatModelDefinition extends ModelDefinitionBase {
  type: 'chat';
  params: ChatModelParams;
}

export interface ImageModelDefinition extends ModelDefinitionBase {
  type: 'image';
  params: ImageModelParams;
}

export interface VideoModelDefinition extends ModelDefinitionBase {
  type: 'video';
  params: VideoModelParams;
}

export type ModelDefinition = ChatModelDefinition | ImageModelDefinition | VideoModelDefinition;

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isBuiltIn: boolean;
  isDefault: boolean;
}

export interface ActiveModels {
  chat: string;
  image: string;
  video: string;
}

export interface ModelRegistryState {
  providers: ModelProvider[];
  models: ModelDefinition[];
  activeModels: ActiveModels;
  globalApiKey?: string;
}

export interface ChatOptions {
  prompt: string;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
  timeout?: number;
  overrideParams?: Partial<ChatModelParams>;
}

export interface ImageGenerateOptions {
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
}

export interface VideoGenerateOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
}

export const DEFAULT_CHAT_PARAMS: ChatModelParams = {
  temperature: 0.7,
  maxTokens: undefined,
};

export const DEFAULT_IMAGE_PARAMS: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
};

export const DEFAULT_VIDEO_PARAMS_VEO: VideoModelParams = {
  mode: 'sync',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 8,
  supportedDurations: [8],
};

export const DEFAULT_VIDEO_PARAMS_SORA: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

export const DEFAULT_VIDEO_PARAMS_DOUBAO: VideoModelParams = {
  mode: 'doubao',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

export const BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  {
    id: 'qwen-max',
    name: '通义千问 Max',
    type: 'chat',
    providerId: 'aliyun',
    endpoint: '/chat/completions',
    description: '阿里云通义千问超大规模语言模型，支持复杂指令和长文本',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    type: 'chat',
    providerId: 'deepseek',
    endpoint: '/chat/completions',
    description: 'DeepSeek 深度求索对话模型，逻辑推理能力强',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'doubao-pro-32k',
    name: '豆包 Pro 32k',
    type: 'chat',
    providerId: 'volcengine',
    endpoint: '/chat/completions',
    description: '字节跳动豆包大模型，适合长文本处理',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
];

export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'doubao-image',
    name: '豆包图像生成',
    type: 'image',
    providerId: 'volcengine',
    endpoint: '/images/generations',
    description: '火山引擎豆包图像生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
  {
    id: 'wanx-v1',
    name: '通义万相 (Wanx)',
    type: 'image',
    providerId: 'aliyun',
    endpoint: '/services/aigc/image-generation/generation',
    description: '阿里云通义万相图像生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
];

export const BUILTIN_VIDEO_MODELS: VideoModelDefinition[] = [
  {
    id: 'doubao-video',
    name: '豆包视频生成',
    type: 'video',
    providerId: 'volcengine',
    endpoint: '/v1/videos/generations',
    description: '字节跳动豆包视频生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_DOUBAO },
  },
  {
    id: 'qwen-video',
    name: '通义千问视频生成',
    type: 'video',
    providerId: 'aliyun',
    endpoint: '/v1/services/aigc/video-generation/video-synthesis',
    description: '阿里云通义千问视频生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'qwen',
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16'],
      defaultDuration: 8,
      supportedDurations: [8],
    },
  },
];

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'aliyun',
    name: '阿里云百炼 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    isBuiltIn: true,
    isDefault: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    baseUrl: 'https://api.deepseek.com/v1',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'volcengine',
    name: '火山引擎 (Volcengine)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    isBuiltIn: true,
    isDefault: false,
  },
];

export const ALL_BUILTIN_MODELS: ModelDefinition[] = [
  ...BUILTIN_CHAT_MODELS,
  ...BUILTIN_IMAGE_MODELS,
  ...BUILTIN_VIDEO_MODELS,
];

export const DEFAULT_ACTIVE_MODELS: ActiveModels = {
  chat: 'qwen-max',
  image: 'doubao-image',
  video: 'doubao-video',
};

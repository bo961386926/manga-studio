export interface CharacterVariation {
  id: string;
  name: string;
  visualPrompt: string;
  negativePrompt?: string;
  referenceImage?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Character {
  id: string;
  name: string;
  gender: string;
  age: string;
  personality: string;
  visualPrompt?: string;
  negativePrompt?: string;
  coreFeatures?: string;
  referenceImage?: string;
  variations: CharacterVariation[];
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Scene {
  id: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt?: string;
  negativePrompt?: string;
  referenceImage?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export type AssetLibraryItemType = 'character' | 'scene';

export interface AssetLibraryItem {
  id: string;
  type: AssetLibraryItemType;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: Character | Scene;
}

export interface Keyframe {
  id: string;
  type: 'start' | 'end';
  visualPrompt: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface VideoInterval {
  id: string;
  startKeyframeId: string;
  endKeyframeId: string;
  duration: number;
  motionStrength: number;
  videoUrl?: string;
  videoPrompt?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Shot {
  id: string;
  sceneId: string;
  actionSummary: string;
  dialogue?: string; 
  cameraMovement: string;
  shotSize?: string; 
  characters: string[];
  characterVariations?: { [characterId: string]: string };
  keyframes: Keyframe[];
  interval?: VideoInterval;
  videoModel?: string; // 统一使用字符串，具体模型 ID 由网关解析
}

export interface ScriptData {
  title: string;
  genre: string;
  logline: string;
  targetDuration?: string;
  language?: string;
  visualStyle?: string;
  shotGenerationModel?: string;
  characters: Character[];
  scenes: Scene[];
  storyParagraphs: { id: number; text: string; sceneRefId: string }[];
}

export interface RenderLog {
  id: string;
  timestamp: number;
  type: 'character' | 'character-variation' | 'scene' | 'keyframe' | 'video' | 'script-parsing';
  resourceId: string;
  resourceName: string;
  status: 'success' | 'failed';
  model: string;
  prompt?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  duration?: number;
}

export interface ProjectState {
  id: string;
  title: string;
  createdAt: number;
  lastModified: number;
  stage: 'script' | 'assets' | 'director' | 'export' | 'prompts';
  /** 列表封面（人物/场景参考图或关键帧），仅服务端列表接口返回 */
  cover?: string;
  /** 一句话梗概，仅服务端列表接口返回 */
  logline?: string;
  
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  shotGenerationModel: string;
  
  scriptData: ScriptData | null;
  shots: Shot[];
  isParsingScript: boolean;
  /** 任务进行中的步骤描述(持久化到项目,切页/刷新后恢复显示) */
  taskStep?: string;
  /** 任务失败信息(持久化,切页后恢复显示) */
  taskError?: string;
  renderLogs: RenderLog[];
}

// Re-export model-related types from types/model.ts (single source of truth)
export type {
  AspectRatio,
  VideoDuration,
  ModelProvider,
  ModelDefinition,
  ModelDefinitionBase,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
  ModelParams,
  ChatModelParams,
  ImageModelParams,
  VideoModelParams,
  ModelType,
  ActiveModels,
  ModelRegistryState,
  ChatOptions,
  ImageGenerateOptions,
  VideoGenerateOptions,
  VideoMode,
} from './types/model';

// Re-export constants
export {
  DEFAULT_CHAT_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_PARAMS_VEO,
  DEFAULT_VIDEO_PARAMS_SORA,
  DEFAULT_VIDEO_PARAMS_DOUBAO,
  BUILTIN_CHAT_MODELS,
  BUILTIN_IMAGE_MODELS,
  BUILTIN_VIDEO_MODELS,
  BUILTIN_PROVIDERS,
  ALL_BUILTIN_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_ACTIVE_MODELS,
} from './types/model';

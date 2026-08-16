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
  videoModel?: 'veo' | 'sora-2' | 'veo_3_1_t2v_fast_landscape' | 'veo_3_1_t2v_fast_portrait' | 'veo_3_1_i2v_s_fast_fl_landscape' | 'veo_3_1_i2v_s_fast_fl_portrait';
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
  
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  shotGenerationModel: string;
  
  scriptData: ScriptData | null;
  shots: Shot[];
  isParsingScript: boolean;
  renderLogs: RenderLog[];
}

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = 4 | 8 | 12;

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isDefault?: boolean;
  isBuiltIn?: boolean;
}

export interface ChatModelConfig {
  providerId: string;
  modelName: string;
  endpoint?: string;
}

export interface ImageModelConfig {
  providerId: string;
  modelName: string;
  endpoint?: string;
}

export interface VideoModelConfig {
  providerId: string;
  type: 'sora' | 'veo';
  modelName: string;
  endpoint?: string;
}

export interface ModelConfig {
  chatModel: ChatModelConfig;
  imageModel: ImageModelConfig;
  videoModel: VideoModelConfig;
}

export interface ModelManagerState {
  providers: ModelProvider[];
  currentConfig: ModelConfig;
  defaultAspectRatio: AspectRatio;
  defaultVideoDuration: VideoDuration;
}

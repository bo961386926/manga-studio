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
} from './modelRegistry';
import { setGlobalApiKey as setGeminiApiKey } from './geminiService';

export { ApiKeyError };

export const chat = async (options: ChatOptions): Promise<string> => {
  return callChatApi(options);
};

export const chatJson = async (options: Omit<ChatOptions, 'responseFormat'>): Promise<string> => {
  return callChatApi({ ...options, responseFormat: 'json' });
};

export const generateImage = async (options: ImageGenerateOptions): Promise<string> => {
  return callImageApi(options);
};

export const generateVideo = async (options: VideoGenerateOptions): Promise<string> => {
  return callVideoApi(options);
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

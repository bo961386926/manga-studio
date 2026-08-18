// Author: forsearch | Updated: 2026-04-30
import { ScriptData, Shot, Character, Scene, AspectRatio, VideoDuration } from "../types";
import { proxyFetch } from './apiClient';
import { addRenderLogWithTokens } from './renderLogService';
import { throwFromVideoHttpError, formatModerationBlockedForUser } from './videoHttpErrors';
import { resolveSoraVideoDownloadId, extractSoraDirectVideoUrl, fetchVideoUrlAsDataUrl } from './soraVideoResolve';
import { 
  getGlobalApiKey as getRegistryApiKey,
  setGlobalApiKey as setRegistryApiKey,
  getApiBaseUrlForModel,
  getApiKeyForModel,
  getModelById,
  getModels,
  getActiveModel,
  getActiveChatModel,
  getActiveVideoModel,
  getActiveImageModel,
} from './modelRegistry';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

let runtimeApiKey: string = process.env.API_KEY || "";

export const setGlobalApiKey = (key: string) => {
  runtimeApiKey = key;
  setRegistryApiKey(key);
};

const resolveModel = (type: 'chat' | 'image' | 'video', modelId?: string) => {
  if (type === 'chat') {
    const key = getRegistryApiKey();
    if (key && key.startsWith('ark-')) {
      const doubaoModel = getModelById('doubao-pro-32k');
      if (doubaoModel) return doubaoModel;
    }
  }

  if (modelId) {
    const model = getModelById(modelId);
    if (model && model.type === type) return model;
    const candidates = getModels(type).filter(m => m.apiModel === modelId);
    if (candidates.length === 1) return candidates[0];
  }
  return getActiveModel(type);
};

const resolveRequestModel = (type: 'chat' | 'image' | 'video', modelId?: string): string => {
  const resolved = resolveModel(type, modelId);
  return resolved?.apiModel || resolved?.id || modelId || '';
};

const checkApiKey = (type: 'chat' | 'image' | 'video' = 'chat', modelId?: string) => {
  const resolvedModel = resolveModel(type, modelId);
  
  console.log(`[API Key Check] Type: ${type}, ModelId: ${modelId}, ResolvedModel: ${resolvedModel?.id}, Provider: ${resolvedModel?.providerId}`);
  
  if (resolvedModel) {
    const modelApiKey = getApiKeyForModel(resolvedModel.id);
    console.log(`[API Key Check] Model-level key for ${resolvedModel.id}: ${modelApiKey ? 'FOUND' : 'NOT FOUND'}`);
    if (modelApiKey) return modelApiKey;
  }
  
  const registryKey = getRegistryApiKey();
  console.log(`[API Key Check] Registry global key: ${registryKey ? 'FOUND' : 'NOT FOUND'}`);
  if (registryKey) return registryKey;
  
  console.log(`[API Key Check] Runtime key: ${runtimeApiKey ? 'FOUND' : 'NOT FOUND'}`);
  if (runtimeApiKey) return runtimeApiKey;
  
  throw new ApiKeyError("API Key 缺失，请在模型配置 -> 全局配置中为对应服务商设置 API Key。");
};

const DEFAULT_API_BASE = 'http://api.gitcc.com';

const SCRIPT_INPUT_MAX_CHARS = 120000;
const LONG_FORM_MAX_TOKENS = 8192;
const PARAGRAPHS_CHUNK_MAX_TOKENS = 8192;

const getApiBase = (type: 'chat' | 'image' | 'video' = 'chat', modelId?: string): string => {
  try {
    const resolvedModel = resolveModel(type, modelId);
    if (resolvedModel) {
      return getApiBaseUrlForModel(resolvedModel.id);
    }
    return getDefaultApiBase();
  } catch (e) {
    return getDefaultApiBase();
  }
};

const getDefaultApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const o = window.location.origin;
    const isLocal = o.startsWith('http://localhost') || o.startsWith('http://127.0.0.1') || o.startsWith('https://localhost') || o.startsWith('https://127.0.0.1');
    if (isLocal && DEFAULT_API_BASE === 'http://api.gitcc.com') return '/api-proxy';
  }
  return DEFAULT_API_BASE;
};

const getActiveChatModelName = (): string => {
  try {
    const model = getActiveChatModel();
    return model?.apiModel || model?.id || 'gpt-5.1';
  } catch (e) {
    return 'gpt-5.1';
  }
};

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: AspectRatio): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  
  if (hasReferenceImage) {
    return `veo_3_1_i2v_s_fast_fl_${orientation}`;
  } else {
    return `veo_3_1_t2v_fast_${orientation}`;
  }
};

const getSoraVideoSize = (aspectRatio: AspectRatio): string => {
  const sizeMap: Record<AspectRatio, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
  };
  return sizeMap[aspectRatio];
};

const ANTSK_API_BASE = DEFAULT_API_BASE;

export const verifyApiKey = async (key: string): Promise<{ success: boolean; message: string }> => {
  try {
    const apiBase = getApiBase('chat');
    const response = await proxyFetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-41',
        messages: [{ role: 'user', content: '仅返回1' }],
        temperature: 0.1,
        max_tokens: 5
      })
    });

    if (!response.ok) {
      let errorMessage = `验证失败: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        // ignore
      }
      return { success: false, message: errorMessage };
    }

    const data = await response.json();
    if (data.choices?.[0]?.message?.content !== undefined) {
      return { success: true, message: 'API Key 验证成功' };
    } else {
      return { success: false, message: '返回格式异常' };
    }
  } catch (error: any) {
    return { success: false, message: error.message || '网络错误' };
  }
};



/**
 * 重试操作辅助函数，用于处理429限流错误、超时错误和其他临时性错误
 * @param operation - 要执行的异步操作函数
 * @param maxRetries - 最大重试次数，默认3次
 * @param baseDelay - 基础延迟时间（毫秒），默认2000ms，采用指数退避策略
 * @returns 返回操作结果
 * @throws 如果所有重试都失败，则抛出最后一次的错误
 */
const retryOperation = async <T>(operation: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 2000): Promise<T> => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e: any) {
      lastError = e;
      // 判断是否是可重试的错误
      const isRetryableError = 
        e.status === 429 || 
        e.status === 502 ||
        e.status === 503 ||
        e.code === 429 || 
        e.status === 504 ||
        e.message?.includes('429') || 
        e.message?.includes('502') ||
        e.message?.includes('503') ||
        e.message?.includes('quota') || 
        e.message?.includes('RESOURCE_EXHAUSTED') ||
        e.message?.includes('overloaded') ||
        e.message?.includes('cpu overloaded') ||
        e.message?.includes('超时') ||
        e.message?.includes('timeout') ||
        e.message?.includes('Gateway Timeout') ||
        e.message?.includes('504') ||
        e.message?.includes('ECONNRESET') ||
        e.message?.includes('ETIMEDOUT') ||
        e.message?.includes('network') ||
        e.status >= 500;
      
      if (isRetryableError && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`请求失败，正在重试... (第 ${i + 1}/${maxRetries} 次，${delay}ms后重试)`, e.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
};

const cleanJsonString = (str: string): string => {
  if (!str) return "{}";
  
  let cleaned = str.trim();
  
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  
  cleaned = cleaned.replace(/```\s*$/, '');
  
  return cleaned.trim();
};

const chatCompletion = async (prompt: string, model: string = 'gpt-5.1', temperature: number = 0.7, maxTokens: number = 8192, responseFormat?: 'json_object', timeout: number = 600000): Promise<string> => {
  const apiKey = checkApiKey('chat', model);
  const requestModel = resolveRequestModel('chat', model);
  const resolvedModel = resolveModel('chat', model);
  
  const requestBody: any = {
    model: requestModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: temperature,
    max_tokens: maxTokens
  };
  
  // MiniMax OpenAI 兼容接口不支持 response_format 参数，依赖提示词输出 JSON
  if (responseFormat === 'json_object' && resolvedModel?.providerId !== 'minimax') {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const apiBase = getApiBase('chat', model);
    const endpoint = resolvedModel?.endpoint || '/v1/chat/completions';
    const fullUrl = `${apiBase}${endpoint}`;
    console.log(`[API Request] Chat - Model: ${requestModel}, URL: ${fullUrl}`);
    const response = await proxyFetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

  if (!response.ok) {
    let errorMessage = `HTTP错误: ${response.status}`;
    const raw = await response.text();
    try {
      if (raw) {
        const errorData = JSON.parse(raw);
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      }
    } catch (_) {
      if (raw) errorMessage = raw;
    }
    // MiniMax 余额不足(1008)等错误的中文友好提示
    if (errorMessage.includes('insufficient balance') || errorMessage.includes('1008')) {
      errorMessage = 'MiniMax 账户余额不足 (1008)：请前往 MiniMax 开放平台充值或领取免费额度后重试';
    }
    throw new Error(errorMessage);
  }

  const data = JSON.parse(await response.text() || '{}');
  return data.choices?.[0]?.message?.content || '';
  } catch (error: any) {
    clearTimeout(timeoutId);
    // 检查是否是超时错误
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout}ms）`);
    }
    throw error;
  }
};

/**
 * 调用聊天完成API（SSE流式模式）
 * @param prompt - 提示词内容
 * @param model - 使用的模型名称
 * @param temperature - 温度参数
 * @param responseFormat - 响应格式（仅用于JSON场景）
 * @param timeout - 超时时间（毫秒）
 * @param onDelta - 每次收到增量文本时回调
 * @returns 返回完整文本
 */
const chatCompletionStream = async (
  prompt: string,
  model: string = 'gpt-5.1',
  temperature: number = 0.7,
  responseFormat: 'json_object' | undefined,
  timeout: number = 600000,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const apiKey = checkApiKey('chat', model);
  const requestModel = resolveRequestModel('chat', model);
  const resolvedModel = resolveModel('chat', model);
  const requestBody: any = {
    model: requestModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: temperature,
    stream: true
  };

  // MiniMax OpenAI 兼容接口不支持 response_format 参数，依赖提示词输出 JSON
  if (responseFormat === 'json_object' && resolvedModel?.providerId !== 'minimax') {
    requestBody.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const apiBase = getApiBase('chat', model);
    const endpoint = resolvedModel?.endpoint || '/v1/chat/completions';
    const response = await proxyFetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage = `HTTP错误: ${response.status}`;
      const raw = await response.text();
      try {
        if (raw) {
          const errorData = JSON.parse(raw);
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        }
      } catch (_) {
        if (raw) errorMessage = raw;
      }
      // MiniMax 余额不足(1008)等错误的中文友好提示
      if (errorMessage.includes('insufficient balance') || errorMessage.includes('1008')) {
        errorMessage = 'MiniMax 账户余额不足 (1008)：请前往 MiniMax 开放平台充值或领取免费额度后重试';
      }
      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error('响应流为空，无法进行流式处理');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const chunk = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);

        if (chunk) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const dataStr = line.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') {
              clearTimeout(timeoutId);
              return fullText;
            }
            try {
              const payload = JSON.parse(dataStr);
              const delta = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
              if (delta) {
                fullText += delta;
                onDelta?.(delta);
              }
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }

        boundaryIndex = buffer.indexOf('\n\n');
      }
    }

    clearTimeout(timeoutId);
    return fullText;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout}ms）`);
    }
    throw error;
  }
};

/**
 * Agent 1 & 2: Script Structuring & Breakdown（長文本兩階段解析）
 * 第一階段：只抽取結構（title, genre, logline, characters, scenes），避免單次輸出過長被截斷
 * 第二階段：按場景分塊抽取 storyParagraphs，每場景一次請求，再合併
 */
export const parseScriptToData = async (rawText: string, language: string = '中文', model: string = 'gpt-5.1', visualStyle: string = 'live-action'): Promise<ScriptData> => {
  console.log('📝 parseScriptToData 调用（長文本兩階段）- 模型:', model, '视觉风格:', visualStyle);
  console.log(`[parseScriptToData] 输入文本长度: ${rawText.length} 字符`);
  const startTime = Date.now();
  const inputText = rawText.slice(0, SCRIPT_INPUT_MAX_CHARS);
  if (rawText.length > SCRIPT_INPUT_MAX_CHARS) {
    console.warn(`[parseScriptToData] 劇本已截斷至 ${SCRIPT_INPUT_MAX_CHARS} 字，原始長度: ${rawText.length}`);
  }

  try {
    // ---------- 階段 1：只抽取結構，不包含 storyParagraphs ----------
    const structurePrompt = `
Analyze the text and output a JSON object in the language: ${language}.

Tasks:
1. Extract title, genre, logline (in ${language}).
2. Extract characters (id, name, gender, age, personality).
3. Extract scenes (id, location, time, atmosphere).
Do NOT output storyParagraphs in this step.

Input:
"${inputText}"

Output ONLY valid JSON with this structure (no storyParagraphs):
{
  "title": "string",
  "genre": "string",
  "logline": "string",
  "characters": [{"id": "string", "name": "string", "gender": "string", "age": "string", "personality": "string"}],
  "scenes": [{"id": "string", "location": "string", "time": "string", "atmosphere": "string"}]
}
`;

    let responseText = await retryOperation(() =>
      chatCompletion(structurePrompt, model, 0.7, LONG_FORM_MAX_TOKENS, 'json_object')
    );

    if (!responseText?.trim()) {
      throw new Error('AI 未返回任何內容，請檢查模型是否可用或稍後重試。');
    }

    const text = cleanJsonString(responseText);
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse script structure JSON:", e);
      console.error("Raw (first 500 chars):", responseText.slice(0, 500));
      throw new Error('AI 返回的結構格式無法解析，請重試或換用其他模型。');
    }

    const characters = Array.isArray(parsed.characters)
      ? parsed.characters.map((c: any) => ({
          ...c,
          id: String(c.id),
          variations: [] as any[]
        }))
      : [];
    const scenes = Array.isArray(parsed.scenes)
      ? parsed.scenes.map((s: any) => ({ ...s, id: String(s.id) }))
      : [];

    if (characters.length === 0 && scenes.length === 0) {
      throw new Error('AI 未能從文本中提取角色或場景。請確保輸入的是完整故事/劇本（含人物與地點）。');
    }

    const genre = parsed.genre || '通用';

    // ---------- 階段 2：按場景分塊抽取 storyParagraphs ----------
    const storyParagraphs: { id: number; text: string; sceneRefId: string }[] = [];
    let nextId = 1;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const scenePrompt = `
Given the script and scene list below, extract ONLY the story paragraphs that belong to this scene.
Scene to extract for: id="${scene.id}", location="${scene.location}".

Full script:
"${inputText}"

All scene IDs for reference: ${scenes.map((s: any) => s.id).join(', ')}

Output ONLY a JSON array of objects. Each object: {"id": number, "text": string, "sceneRefId": "${scene.id}"}.
Use short paragraph texts. Language: ${language}.
`;

      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        const paraResponse = await retryOperation(() =>
          chatCompletion(scenePrompt, model, 0.5, PARAGRAPHS_CHUNK_MAX_TOKENS, 'json_object')
        );
        const paraCleaned = cleanJsonString(paraResponse);
        let arr: any[] = [];
        try {
          const parsedPara = JSON.parse(paraCleaned);
          arr = Array.isArray(parsedPara)
            ? parsedPara
            : Array.isArray(parsedPara.storyParagraphs)
              ? parsedPara.storyParagraphs
              : Array.isArray(parsedPara.paragraphs)
                ? parsedPara.paragraphs
                : (() => {
                    const v = Object.values(parsedPara).find((x: any) => Array.isArray(x));
                    return Array.isArray(v) ? v : [];
                  })();
        } catch (_) {
          // 解析失敗時保留空陣列，該場景段落略過
          arr = [];
        }
        arr.forEach((p: any) => {
          if (p && (p.text || p.content)) {
            storyParagraphs.push({
              id: nextId++,
              text: typeof p.text === 'string' ? p.text : String(p.content || ''),
              sceneRefId: String(scene.id)
            });
          }
        });
      } catch (e) {
        console.warn(`[parseScriptToData] 場景 ${scene.location} 段落抽取失敗，跳過:`, e);
      }
    }

    // 若按場景抽取結果為空，可選：做一次整體抽取（較長輸出）
    if (storyParagraphs.length === 0 && scenes.length > 0) {
      console.log('[parseScriptToData] 按場景抽取無段落，嘗試單次整體抽取...');
      const fallbackPrompt = `
Break down the story into paragraphs linked to scenes. Language: ${language}.
Script:
"${inputText.slice(0, 60000)}"

Scenes (use these sceneRefId): ${JSON.stringify(scenes.map((s: any) => ({ id: s.id, location: s.location })))}

Output ONLY valid JSON: { "storyParagraphs": [ {"id": number, "text": "string", "sceneRefId": "string"} ] }
`;
      try {
        const fallbackResp = await retryOperation(() =>
          chatCompletion(fallbackPrompt, model, 0.6, LONG_FORM_MAX_TOKENS, 'json_object')
        );
        const fallbackParsed = JSON.parse(cleanJsonString(fallbackResp));
        const list = Array.isArray(fallbackParsed.storyParagraphs) ? fallbackParsed.storyParagraphs : [];
        list.forEach((p: any, idx: number) => {
          if (p && (p.text || p.content)) {
            storyParagraphs.push({
              id: nextId++,
              text: typeof p.text === 'string' ? p.text : String(p.content || ''),
              sceneRefId: String(p.sceneRefId || scenes[0]?.id || '')
            });
          }
        });
      } catch (e2) {
        console.warn('[parseScriptToData] 整體段落抽取也失敗:', e2);
      }
    }

    // ---------- 生成角色與場景的視覺提示詞 ----------
    console.log('🎨 正在为角色和场景生成视觉提示词...', `风格: ${visualStyle}`);
    for (let i = 0; i < characters.length; i++) {
      try {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('character', characters[i], genre, model, visualStyle, language);
        characters[i].visualPrompt = prompts.visualPrompt;
        (characters[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Failed to generate visual prompt for character ${characters[i].name}:`, e);
      }
    }
    for (let i = 0; i < scenes.length; i++) {
      try {
        if (i > 0 || characters.length > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('scene', scenes[i], genre, model, visualStyle, language);
        scenes[i].visualPrompt = prompts.visualPrompt;
        (scenes[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Failed to generate visual prompt for scene ${scenes[i].location}:`, e);
      }
    }

    console.log('✅ 视觉提示词生成完成！');
    const result: ScriptData = {
      title: parsed.title || '未命名剧本',
      genre,
      logline: parsed.logline || '',
      language,
      characters,
      scenes,
      storyParagraphs
    };

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'script-parse-' + Date.now(),
      resourceName: result.title,
      status: 'success',
      model,
      prompt: structurePrompt.substring(0, 200) + '...',
      duration: Date.now() - startTime
    });
    return result;
  } catch (error: any) {
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'script-parse-' + Date.now(),
      resourceName: '剧本解析',
      status: 'failed',
      model,
      prompt: '',
      error: error.message,
      duration: Date.now() - startTime
    });
    throw error;
  }
};

/**
 * 生成分镜列表
 * 根据剧本数据和目标时长，为每个场景生成适量的分镜头
 * 算法：目标时长(秒) ÷ 10秒/镜头 = 总镜头数，然后平均分配到各场景
 * @param scriptData - 剧本数据，包含场景、角色、目标时长等信息
 * @param model - 使用的AI模型，默认'gpt-5.1'
 * @returns 返回分镜头列表，每个镜头包含关键帧、镜头运动等信息
 */
export const generateShotList = async (scriptData: ScriptData, model: string = 'gpt-5.1'): Promise<Shot[]> => {
  const overallStartTime = Date.now();
  
  if (!scriptData.scenes || scriptData.scenes.length === 0) {
    console.warn('[generateShotList] 无场景数据，返回空数组');
    return [];
  }

  const lang = scriptData.language || '中文';
  const visualStyle = scriptData.visualStyle || 'live-action';
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  
  const targetDurationStr = scriptData.targetDuration || '60s';
  const targetSeconds = parseInt(targetDurationStr.replace(/[^\d]/g, '')) || 60;
  const totalShotsTarget = Math.round(targetSeconds / 10);
  console.log(`[generateShotList] 开始生成分镜 - 场景数: ${scriptData.scenes.length}, 视觉风格: ${visualStyle}, 目标时长: ${targetDurationStr}, 预计镜位数: ${totalShotsTarget}, 模型: ${model}`);
  
  // 逐场景生成可降低长文本 JSON 解析失败和 token 超限风险。
  const processScene = async (scene: Scene, index: number): Promise<Shot[]> => {
    const sceneStartTime = Date.now();
    console.log(`[generateShotList] 开始处理场景 ${index + 1}/${scriptData.scenes.length}: "${scene.location}" (${scene.id})`);
    const paragraphs = scriptData.storyParagraphs
      .filter(p => String(p.sceneRefId) === String(scene.id))
      .map(p => p.text)
      .join('\n');

    if (!paragraphs.trim()) return [];

    const targetDurationStr = scriptData.targetDuration || '60s';
    const targetSeconds = parseInt(targetDurationStr.replace(/[^\d]/g, '')) || 60;
    const totalShotsNeeded = Math.round(targetSeconds / 10);
    const scenesCount = scriptData.scenes.length;
    const shotsPerScene = Math.max(1, Math.round(totalShotsNeeded / scenesCount));
    
    const prompt = `
      Act as a professional cinematographer. Generate a detailed shot list (Camera blocking) for Scene ${index + 1}.
      Language for Text Output: ${lang}.
      
      IMPORTANT VISUAL STYLE: ${stylePrompt}
      All 'visualPrompt' fields MUST describe shots in this "${visualStyle}" style.
      
      Scene Details:
      Location: ${scene.location}
      Time: ${scene.time}
      Atmosphere: ${scene.atmosphere}
      
      Scene Action:
      "${paragraphs.slice(0, 12000)}"
      
      Context:
      Genre: ${scriptData.genre}
      Visual Style: ${visualStyle} (${stylePrompt})
      Target Duration (Whole Script): ${scriptData.targetDuration || 'Standard'}
      Total Shots Budget: ${totalShotsNeeded} shots (Each shot = 10 seconds of video)
      Shots for This Scene: Approximately ${shotsPerScene} shots
      
      Characters:
      ${JSON.stringify(scriptData.characters.map(c => ({ id: c.id, name: c.name, desc: c.visualPrompt || c.personality })))}

      Professional Camera Movement Reference (Choose from these categories):
      - Horizontal Left Shot (向左平移) - Camera moves left
      - Horizontal Right Shot (向右平移) - Camera moves right
      - Pan Left Shot (平行向左扫视) - Pan left
      - Pan Right Shot (平行向右扫视) - Pan right
      - Vertical Up Shot (向上直线运动) - Move up vertically
      - Vertical Down Shot (向下直线运动) - Move down vertically
      - Tilt Up Shot (向上仰角运动) - Tilt upward
      - Tilt Down Shot (向下俯角运动) - Tilt downward
      - Zoom Out Shot (镜头缩小/拉远) - Pull back/zoom out
      - Zoom In Shot (镜头放大/拉近) - Push in/zoom in
      - Dolly Shot (推镜头) - Dolly in/out movement
      - Circular Shot (环绕拍摄) - Orbit around subject
      - Over the Shoulder Shot (越肩镜头) - Over shoulder perspective
      - Pan Shot (摇镜头) - Pan movement
      - Low Angle Shot (仰视镜头) - Low angle view
      - High Angle Shot (俯视镜头) - High angle view
      - Tracking Shot (跟踪镜头) - Follow subject
      - Handheld Shot (摇摄镜头) - Handheld camera
      - Static Shot (静止镜头) - Fixed camera position
      - POV Shot (主观视角) - Point of view
      - Bird's Eye View Shot (俯瞰镜头) - Overhead view
      - 360-Degree Circular Shot (360度环绕) - Full circle
      - Parallel Tracking Shot (平行跟踪) - Side tracking
      - Diagonal Tracking Shot (对角跟踪) - Diagonal tracking
      - Rotating Shot (旋转镜头) - Rotating movement
      - Slow Motion Shot (慢动作) - Slow-mo effect
      - Time-Lapse Shot (延时摄影) - Time-lapse
      - Canted Shot (斜视镜头) - Dutch angle
      - Cinematic Dolly Zoom (电影式变焦推轨) - Vertigo effect

      Instructions:
      1. Create EXACTLY ${shotsPerScene} shots (or ${shotsPerScene - 1} to ${shotsPerScene + 1} shots if needed for story flow) for this scene.
      2. CRITICAL: Each shot will be 10 seconds. Total shots must match the target duration formula: ${targetSeconds} seconds ÷ 10 = ${totalShotsNeeded} total shots across all scenes.
      3. DO NOT exceed ${shotsPerScene + 1} shots for this scene. Select the most important moments only.
      4. 'cameraMovement': Can reference the Professional Camera Movement Reference list above for inspiration, or use your own creative camera movements. You may use the exact English terms (e.g., "Dolly Shot", "Pan Right Shot", "Zoom In Shot", "Tracking Shot") or describe custom movements.
      5. 'shotSize': Specify the field of view (e.g., Extreme Close-up, Medium Shot, Wide Shot).
      6. 'actionSummary': Detailed description of what happens in the shot (in ${lang}).
      7. 'visualPrompt': Detailed description for image generation in ${visualStyle} style (OUTPUT IN ${lang}). Include style-specific keywords. Keep it under 50 words.
      
      Output ONLY a valid JSON OBJECT with this exact structure (no markdown, no extra text):
      {
        "shots": [
          {
            "id": "string",
            "sceneId": "${scene.id}",
            "actionSummary": "string",
            "dialogue": "string (empty if none)",
            "cameraMovement": "string",
            "shotSize": "string",
            "characters": ["string"],
            "keyframes": [
              {"id": "string", "type": "start|end", "visualPrompt": "string (MUST include ${visualStyle} style keywords)"}
            ]
          }
        ]
      }
    `;

    let responseText = '';
    try {
      responseText = await retryOperation(() => chatCompletion(prompt, model, 0.7, LONG_FORM_MAX_TOKENS, 'json_object'));
      const text = cleanJsonString(responseText);
      const parsed = JSON.parse(text);

      // json_object 會強制返回物件，這裡兼容舊版陣列與新版 { shots: [...] }。
      const shots = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray((parsed as any).shots) ? (parsed as any).shots : []);
      
      const validShots = Array.isArray(shots) ? shots : [];
      const result = validShots.map(s => {
        let normalizedCharacters: string[] = [];
        if (Array.isArray(s.characters)) {
          normalizedCharacters = s.characters;
        } else if (typeof s.characters === 'string' && s.characters.trim()) {
          normalizedCharacters = s.characters.split(',').map((c: string) => c.trim()).filter(Boolean);
        }
        return {
          ...s,
          characters: normalizedCharacters,
          sceneId: String(scene.id)
        };
      });
      
      console.log(`[generateShotList] 场景 "${scene.location}" 生成完成: ${result.length} 个镜位, 耗时 ${Date.now() - sceneStartTime}ms, 响应长度: ${responseText.length} 字符`);
      
      addRenderLogWithTokens({
        type: 'script-parsing',
        resourceId: `shot-gen-scene-${scene.id}-${Date.now()}`,
        resourceName: `分镜生成 - 场景${index + 1}: ${scene.location}`,
        status: 'success',
        model: model,
        prompt: prompt.substring(0, 200) + '...',
        duration: Date.now() - sceneStartTime
      });
      
      return result;

    } catch (e: any) {
      console.error(`[generateShotList] 场景 ${scene.id} 分镜生成失败`, e);
      try {
        console.error(`  ↳ sceneId=${scene.id}, sceneIndex=${index}, responseText(snippet)=`, String(responseText || '').slice(0, 500));
      } catch {
        // ignore
      }
      
      addRenderLogWithTokens({
        type: 'script-parsing',
        resourceId: `shot-gen-scene-${scene.id}-${Date.now()}`,
        resourceName: `分镜生成 - 场景${index + 1}: ${scene.location}`,
        status: 'failed',
        model: model,
        prompt: prompt.substring(0, 200) + '...',
        error: e.message || String(e),
        duration: Date.now() - sceneStartTime
      });
      
      return [];
    }
  };

  const BATCH_SIZE = 1;
  const allShots: Shot[] = [];
  
  for (let i = 0; i < scriptData.scenes.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500));
    
    const batch = scriptData.scenes.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((scene, idx) => processScene(scene, i + idx))
    );
    batchResults.forEach(shots => allShots.push(...shots));
  }

  if (allShots.length === 0) {
    throw new Error('分镜生成失败：AI返回为空（可能是 JSON 结构不匹配或场景内容未被识别）。请打开控制台查看分镜生成日志。');
  }

  return allShots.map((s, idx) => ({
    ...s,
    id: `shot-${idx + 1}`,
    characters: Array.isArray(s.characters) ? s.characters : [],
    keyframes: Array.isArray(s.keyframes) ? s.keyframes.map(k => ({ 
      ...k, 
      id: `kf-${idx + 1}-${k.type}`,
      status: 'pending' 
    })) : []
  }));
};

const VISUAL_STYLE_PROMPTS: { [key: string]: string } = {
  'live-action': 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution',
  'anime': 'Japanese anime style, cel-shaded, vibrant colors, expressive eyes, dynamic poses, Studio Ghibli/Makoto Shinkai quality',
  '2d-animation': 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth lines, expressive characters, painterly backgrounds',
  '3d-animation': 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering, detailed textures, stylized characters',
  'cyberpunk': 'cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays, high-tech low-life, Blade Runner style',
  'oil-painting': 'oil painting style, visible brushstrokes, rich textures, classical art composition, museum quality fine art',
};

const NEGATIVE_PROMPTS: { [key: string]: string } = {
  'live-action': 'cartoon, anime, illustration, painting, drawing, 3d render, cgi, low quality, blurry, grainy, watermark, text, logo, signature, distorted face, bad anatomy, extra limbs, mutated hands, deformed, ugly, disfigured, poorly drawn, amateur',
  'anime': 'photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions, grotesque',
  '2d-animation': 'photorealistic, 3d, low quality, pixelated, blurry, watermark, text, bad anatomy, deformed, ugly, amateur drawing, inconsistent style, rough sketch',
  '3d-animation': 'photorealistic, 2d, flat, hand-drawn, low poly, bad topology, texture artifacts, z-fighting, clipping, low quality, blurry, watermark, text, bad rigging, unnatural movement',
  'cyberpunk': 'bright daylight, pastoral, medieval, fantasy, cartoon, low tech, rural, natural, watermark, text, logo, low quality, blurry, amateur',
  'oil-painting': 'digital art, photorealistic, 3d render, cartoon, anime, low quality, blurry, watermark, text, amateur, poorly painted, muddy colors, overworked canvas',
};

/**
 * 生成角色或场景的视觉提示词
 * 根据指定的视觉风格和语言，为角色或场景生成详细的视觉描述
 * @param type - 类型，'character'（角色）或'scene'（场景）
 * @param data - 角色或场景的数据
 * @param genre - 剧本类型/题材
 * @param model - 使用的AI模型，默认'gpt-5.1'
 * @param visualStyle - 视觉风格，如'live-action'、'anime'等，默认'live-action'
 * @param language - 输出语言，默认'中文'
 * @returns 返回包含visualPrompt和negativePrompt的对象
 */
export const generateVisualPrompts = async (type: 'character' | 'scene', data: Character | Scene, genre: string, model: string = 'gpt-5.1', visualStyle: string = 'live-action', language: string = '中文'): Promise<{ visualPrompt: string; negativePrompt: string }> => {
   const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
   const negativePrompt = NEGATIVE_PROMPTS[visualStyle] || NEGATIVE_PROMPTS['live-action'];
   
   let prompt: string;
   
   if (type === 'character') {
     const char = data as Character;
     prompt = `You are an expert AI prompt engineer for ${visualStyle} style image generation.

Create a detailed visual prompt for a character with the following structure:

Character Data:
- Name: ${char.name}
- Gender: ${char.gender}
- Age: ${char.age}
- Personality: ${char.personality}

REQUIRED STRUCTURE (output in ${language}):
1. Core Identity: [ethnicity, age, gender, body type]
2. Facial Features: [specific distinguishing features - eyes, nose, face shape, skin tone]
3. Hairstyle: [detailed hair description - color, length, style]
4. Clothing: [detailed outfit appropriate for ${genre} genre]
5. Pose & Expression: [body language and facial expression matching personality]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Sections 1-3 are FIXED features for consistency across all variations
- Use specific, concrete visual details
- Output as single paragraph, comma-separated
- MUST include style keywords: ${visualStyle}
- Length: 60-90 words
- Focus on visual details that can be rendered in images

Output ONLY the visual prompt text, no explanations.`;
   } else {
     const scene = data as Scene;
     prompt = `You are an expert cinematographer and AI prompt engineer for ${visualStyle} productions.

Create a cinematic scene prompt with this structure:

Scene Data:
- Location: ${scene.location}
- Time: ${scene.time}
- Atmosphere: ${scene.atmosphere}
- Genre: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Environment: [detailed location description with architectural/natural elements]
2. Lighting: [specific lighting setup - direction, color temperature, quality (soft/hard), key light source]
3. Composition: [camera angle (eye-level/low/high), framing rules (rule of thirds/symmetry), depth layers]
4. Atmosphere: [mood, weather, particles in air (fog/dust/rain), environmental effects]
5. Color Palette: [dominant colors, color temperature (warm/cool), saturation level]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Use professional cinematography terminology
- Specify light sources and direction (e.g., "golden hour backlight from right")
- Include composition guidelines (rule of thirds, leading lines, depth of field)
- Output as single paragraph, comma-separated
- MUST emphasize ${visualStyle} style throughout
- Length: 70-110 words
- Focus on elements that establish mood and cinematic quality

Output ONLY the visual prompt text, no explanations.`;
   }

   const visualPrompt = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
   
   return {
     visualPrompt: visualPrompt.trim(),
     negativePrompt: negativePrompt
   };
};

/**
 * 生成图像（Agent 4 & 6）
 * 使用antsk图像生成API (gemini-3-pro-image-preview)
 * 支持参考图像，确保角色和场景的一致性
 * @param prompt - 图像生成提示词
 * @param referenceImages - 参考图像数组（base64格式），第一张为场景参考，后续为角色参考
 * @param aspectRatio - 横竖屏比例，支持 '16:9'（横屏，默认）、'9:16'（竖屏）。注意：Gemini 3 Pro Image 不支持方形(1:1)
 * @param isVariation - 是否为角色变体生成模式（服装变体），变体模式下保持面部一致但改变服装
 * @returns 返回生成的图像base64字符串
 * @throws 如果图像生成失败则抛出错误
 */
export const generateImage = async (
  prompt: string, 
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false
): Promise<string> => {
  const startTime = Date.now();
  
  // 从 modelRegistry 获取当前激活的图片模型
  const activeImageModel = getActiveModel('image');
  const imageModelId = activeImageModel?.apiModel || activeImageModel?.id || 'wanx-v1';
  const apiKey = checkApiKey('image', activeImageModel?.id);
  const apiBase = getApiBase('image', activeImageModel?.id);
  const requestEndpoint = (activeImageModel?.providerId === 'volcengine' || activeImageModel?.id === 'doubao-image')
    ? '/images/generations'
    : activeImageModel?.endpoint || '/v1/images/generations';

  console.log('[ImageGen] Active image model:', {
    id: activeImageModel?.id,
    apiModel: activeImageModel?.apiModel,
    providerId: activeImageModel?.providerId,
    endpoint: activeImageModel?.endpoint,
    apiBase,
    requestUrl: `${apiBase}${requestEndpoint}`,
  });

  try {
    // If we have reference images, instruct the model to use them for consistency
    let finalPrompt = prompt;
    if (referenceImages.length > 0) {
      if (isVariation) {
        // 变体模式：保持面部一致，但改变服装/造型
        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER OUTFIT VARIATION ⚠️⚠️⚠️
      
      Reference Images Information:
      - The provided image shows the CHARACTER's BASE APPEARANCE that you MUST use as reference for FACE ONLY.
      
      Task:
      Generate a character image with a NEW OUTFIT/COSTUME based on this description: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      
      1. FACE & IDENTITY - MUST BE 100% IDENTICAL TO REFERENCE:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched (unless prompt specifies hair change)
         • Skin tone and facial structure: MUST remain identical
         • Expression can vary based on prompt
         
      2. OUTFIT/CLOTHING - MUST BE COMPLETELY DIFFERENT FROM REFERENCE:
         • Generate NEW clothing/outfit as described in the prompt
         • DO NOT copy the clothing from the reference image
         • The outfit should match the description provided: "${prompt}"
         • Include all accessories, props, or costume details mentioned in the prompt
         
      3. Body proportions should remain consistent with the reference.
      
      ⚠️ This is an OUTFIT VARIATION task - The face MUST match the reference, but the CLOTHES MUST be NEW as described!
      ⚠️ If the new outfit is not clearly visible and different from the reference, the task has FAILED!
    `;
      } else {
        // 普通模式：完全一致性（分镜生成等场景）
        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
         
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
    `;
      }
    }

  // 适配不同模型的请求体格式
  let requestBody: any = {};
  
  if (imageModelId.includes('wanx')) {
    // 阿里云通义万相格式
    requestBody = {
      model: imageModelId,
      prompt: finalPrompt,
      n: 1,
      size: aspectRatio === '16:9' ? '1280*720' : (aspectRatio === '9:16' ? '720*1280' : '1024*1024')
    };
    if (referenceImages.length > 0) {
      requestBody.ref_img = referenceImages[0]; // 简化处理，万相可能需要特定参数
    }
  } else if (activeImageModel?.providerId === 'volcengine' || imageModelId.includes('doubao')) {
    // 火山引擎豆包生图格式（要求尺寸至少为 3686400 像素，例如 16:9 为 2560x1440，9:16 为 1440x2560，1:1 为 2048x2048）
    requestBody = {
      model: imageModelId,
      prompt: finalPrompt,
      n: 1,
      size: aspectRatio === '16:9' ? '2560x1440' : (aspectRatio === '9:16' ? '1440x2560' : '2048x2048')
    };
  } else if (activeImageModel?.providerId === 'minimax' || imageModelId.includes('minimax')) {
    // MiniMax 文生图格式 (image-01)：返回 URL 后由前端下载转 base64 存储（URL 24 小时过期）
    // prompt 上限 1500 字符：超长时保留开头核心描述(1150) + 结尾风格/镜头标签(300)，避免 2013 错误
    let miniMaxPrompt = finalPrompt;
    if (miniMaxPrompt.length > 1450) {
      console.warn(`[ImageGen] MiniMax prompt 过长 (${miniMaxPrompt.length} 字符),已截断至 1450`);
      miniMaxPrompt =
        miniMaxPrompt.substring(0, 1150) + '\n...\n' + miniMaxPrompt.substring(miniMaxPrompt.length - 300);
    }
    requestBody = {
      model: imageModelId,
      prompt: miniMaxPrompt,
      n: 1,
      aspect_ratio: aspectRatio,
      response_format: 'url',
      prompt_optimizer: false,
    };
  } else {
    // 默认 OpenAI 格式
    requestBody = {
      model: imageModelId,
      prompt: finalPrompt,
      n: 1,
      size: "1024x1024"
    };
  }

  console.log(`[ImageGen] ========== 开始图片生成请求 ==========`);
  console.log(`[ImageGen] 模型ID: ${activeImageModel?.id}, apiModel: ${imageModelId}`);
  console.log(`[ImageGen] API Base: ${apiBase}, Endpoint: ${requestEndpoint}`);
  console.log(`[ImageGen] 完整请求URL: ${apiBase}${requestEndpoint}`);
  console.log(`[ImageGen] 提示词长度: ${finalPrompt.length} 字符, 前80字: ${finalPrompt.substring(0, 80)}...`);
  console.log(`[ImageGen] 参考图数量: ${referenceImages.length}, 比例: ${aspectRatio}, 变体模式: ${isVariation}`);
  console.log(`[ImageGen] 请求体:`, JSON.stringify({ ...requestBody, prompt: finalPrompt.substring(0, 80) + '...' }));

  const response = await retryOperation(async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    
    // DashScope 兼容模式需要这个 header
    if (imageModelId.includes('wanx') || apiBase.includes('/api-ds')) {
      headers['X-DashScope-Async'] = 'enable';
    }

    let res: Response;
    try {
      res = await proxyFetch(`${apiBase}${requestEndpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
    } catch (networkError: any) {
      console.error(`[ImageGen] ❌ 前端网络请求失败 (无法连接到代理或后端):`, networkError);
      throw new Error(`前端网络错误：无法发起图片生成请求。可能是本地代理配置问题或网络中断。详细信息: ${networkError.message}`);
    }

    console.log(`[ImageGen] HTTP 状态: ${res.status} ${res.statusText}`);
    console.log(`[ImageGen] Content-Type: ${res.headers.get('content-type')}`);

    // 先读原始文本，避免 JSON 解析失败时无法看到内容
    const rawText = await res.text();
    console.log(`[ImageGen] 原始响应长度: ${rawText.length}, 前400字: ${rawText.substring(0, 400)}`);

    if (!res.ok) {
      let errorMessage = `HTTP错误: ${res.status}`;
      try {
        if (rawText) {
          const errorData = JSON.parse(rawText);
          errorMessage = errorData.error?.message || errorData.message || errorData.detail || errorMessage;
        }
      } catch {
        if (rawText) errorMessage = rawText.substring(0, 400);
      }

      if (res.status === 502 || res.status === 504 || res.status === 503) {
        console.error(`[ImageGen] ❌ 代理/网关错误 (${res.status}):`, errorMessage);
        throw new Error(`后端代理/网关错误 (${res.status})：无法连接到大模型上游服务。响应: ${errorMessage}`);
      }
      if (res.status >= 500) {
        console.error(`[ImageGen] ❌ 大模型服务内部异常 (${res.status}):`, errorMessage);
        throw new Error(`大模型服务端暂时异常 (${res.status})：${errorMessage}`);
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        console.error(`[ImageGen] ❌ 大模型请求被拒绝 (${res.status}):`, errorMessage);
        throw new Error(`大模型接口拒绝了请求 (${res.status})：${errorMessage}`);
      }
      if (res.status === 404) {
        console.error(`[ImageGen] ❌ 接口路径不存在 (${res.status}):`, errorMessage);
        throw new Error(`大模型接口不存在 (404)：请检查模型配置的 Endpoint 是否正确。响应: ${errorMessage}`);
      }

      console.error(`[ImageGen] ❌ 图片生成请求失败 (${res.status}):`, errorMessage);
      throw new Error(`图片生成请求失败 (${res.status})：${errorMessage}`);
    }

    if (!rawText) {
      throw new Error("前端解析错误：图片生成返回了空响应");
    }

    try {
      return JSON.parse(rawText);
    } catch (jsonErr: any) {
      console.error(`[ImageGen] ❌ JSON 解析失败:`, jsonErr);
      console.error(`[ImageGen] 原始响应内容:`, rawText.substring(0, 500));
      throw new Error(`前端数据解析错误: 无法解析响应数据 (${jsonErr.message})`);
    }
  });

  // 从字符串中提取 data URL（支持 Markdown：![image](data:image/...)）
  const extractDataUrlFromContent = (text: string): string | null => {
    if (!text || typeof text !== 'string') return null;
    if (/^data:image\//i.test(text.trim())) return text.trim();
    const markdownMatch = text.match(/!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/i);
    if (markdownMatch) return markdownMatch[1];
    const anyDataMatch = text.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (anyDataMatch) return anyDataMatch[1];
    return null;
  };

  // 提取图片：兼容 OpenAI 返回 (choices[].message.content) 与 Gemini 返回 (candidates[].content.parts) 以及 万相返回 (output.results[].url)
  console.log(`[API Response] Image Generation - Data:`, JSON.stringify(response).substring(0, 200) + '...');
  
  const choices = response.choices;
  if (response.output && response.output.results && response.output.results.length > 0) {
    // 阿里云万相格式
    const result = response.output.results[0].url;
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'success',
      model: imageModelId,
      prompt: prompt,
      duration: Date.now() - startTime
    });
    return result;
  } else if (response.data && Array.isArray(response.data.image_urls) && response.data.image_urls.length > 0) {
    // MiniMax 文生图格式:data.image_urls[]（URL 24 小时过期,下载转 base64 存储）
    const url = response.data.image_urls[0];
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'success',
      model: imageModelId,
      prompt: prompt,
      duration: Date.now() - startTime
    });
    const dataUrl = await convertVideoUrlToBase64(url);
    return dataUrl;
  } else if (activeImageModel?.providerId === 'minimax' || imageModelId.includes('minimax')) {
    // MiniMax 生图失败诊断:metadata.failed_count / base_resp / error
    console.error('[ImageGen] MiniMax 生图失败,完整响应:', JSON.stringify(response));
    const failedCount = response.metadata?.failed_count;
    const statusCode = response.base_resp?.status_code;
    const statusMsg = response.base_resp?.status_msg;
    const respError = response.error?.message || response.message;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new Error(`MiniMax 图片生成失败 (${statusCode})：${statusMsg || respError || '请稍后重试'}`);
    }
    if (failedCount) {
      throw new Error(`MiniMax 图片生成失败：内容安全拦截或生成被拒绝（成功 ${response.metadata?.success_count ?? 0} / 失败 ${failedCount}），请调整提示词后重试`);
    }
    throw new Error(`MiniMax 图片生成失败：未返回图片数据${statusMsg ? `（${statusMsg}）` : ''}，请重试或更换提示词`);
  } else if (response.data && response.data.length > 0) {
    // OpenAI 图像生成格式
    const result = response.data[0].url || response.data[0].b64_json;
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'success',
      model: imageModelId,
      prompt: prompt,
      duration: Date.now() - startTime
    });
    return result;
  } else if (choices && choices.length > 0) {
    const msg = choices[0].message;
    const content = msg?.content;
    if (content) {
      if (typeof content === 'string') {
        const result = extractDataUrlFromContent(content) ?? (content.length > 100 ? `data:image/png;base64,${content}` : null);
        if (result) {
          addRenderLogWithTokens({
            type: 'keyframe',
            resourceId: 'image-' + Date.now(),
            resourceName: prompt.substring(0, 50) + '...',
            status: 'success',
            model: imageModelId,
            prompt: prompt,
            duration: Date.now() - startTime
          });
          return result;
        }
      }
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            const result = url.startsWith('data:') ? url : `data:image/png;base64,${url}`;
            addRenderLogWithTokens({
              type: 'keyframe',
              resourceId: 'image-' + Date.now(),
              resourceName: prompt.substring(0, 50) + '...',
              status: 'success',
              model: imageModelId,
              prompt: prompt,
              duration: Date.now() - startTime
            });
            return result;
          }
        }
      }
    }
  }
  const candidates = response.candidates || [];
  if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        const result = `data:image/png;base64,${part.inlineData.data}`;
        addRenderLogWithTokens({
          type: 'keyframe',
          resourceId: 'image-' + Date.now(),
          resourceName: prompt.substring(0, 50) + '...',
          status: 'success',
          model: imageModelId,
          prompt: prompt,
          duration: Date.now() - startTime
        });
        return result;
      }
    }
  }
  throw new Error("图片生成失败 (No image data returned)");
  } catch (error: any) {
    console.error(`[API Error] Image Generation Exception:`, error);
    // Log failed generation
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'failed',
      model: imageModelId,
      prompt: prompt,
      error: error.message,
      duration: Date.now() - startTime
    });
    
    throw error;
  }
};

/**
 * 将视频URL转换为base64格式
 * @param url - 视频文件的URL
 * @returns 返回base64编码的视频数据
 * @throws 如果下载或转换失败则抛出错误
 */
const convertVideoUrlToBase64 = async (url: string): Promise<string> => {
  try {
    // 下载视频文件
    const response = await proxyFetch(url);
    if (!response.ok) {
      throw new Error(`下载视频失败: HTTP ${response.status}`);
    }
    
    // 获取视频blob
    const blob = await response.blob();
    
    // 转换为base64
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        resolve(base64String);
      };
      reader.onerror = () => {
        reject(new Error('转换视频为base64失败'));
      };
      reader.readAsDataURL(blob);
    });
  } catch (error: any) {
    console.error('视频URL转base64失败:', error);
    throw new Error(`视频转换失败: ${error.message}`);
  }
};

/**
 * 调整图片尺寸到指定宽高
 * @param base64Data - 原始图片base64数据（不含前缀）
 * @param targetWidth - 目标宽度
 * @param targetHeight - 目标高度
 * @returns 调整后的图片base64数据（不含前缀）
 */
const resizeImageToSize = async (base64Data: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建canvas上下文'));
        return;
      }
      // 使用 cover 模式填充，保持比例并居中裁剪
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (targetWidth - scaledWidth) / 2;
      const offsetY = (targetHeight - scaledHeight) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      // 返回不含前缀的base64
      const result = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      resolve(result);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = `data:image/png;base64,${base64Data}`;
  });
};

/**
 * sora-2专用：使用异步API生成视频
 * 流程：1. 创建任务 -> 2. 轮询状态 -> 3. 下载视频
 * @param prompt - 视频生成提示词
 * @param startImageBase64 - 起始关键帧图像(base64格式，可选)
 * @param apiKey - API密钥
 * @param aspectRatio - 横竖屏比例，支持 '16:9'（横屏）、'9:16'（竖屏）、'1:1'（方形）
 * @param duration - 视频时长，支持 4、8、12 秒
 * @returns 返回视频的base64编码
 */
const generateVideoWithSora2 = async (
  prompt: string, 
  startImageBase64: string | undefined, 
  apiKey: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'sora-2'
): Promise<string> => {
  console.log(`🎬 使用异步模式生成视频 (${modelName}, ${aspectRatio}, ${duration}秒)...`);
  
  // 根据横竖屏比例计算视频尺寸
  const videoSize = getSoraVideoSize(aspectRatio);
  const [VIDEO_WIDTH, VIDEO_HEIGHT] = videoSize.split('x').map(Number);
  
  console.log(`📐 视频尺寸: ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`);
  
  // 获取 API 基础 URL
  const apiBase = getApiBase('video', modelName);
  
  // Step 1: 创建视频任务
  const formData = new FormData();
  formData.append('model', modelName);
  formData.append('prompt', prompt);
  formData.append('seconds', String(duration));
  formData.append('size', videoSize);
  
  // 如果有参考图片，调整尺寸后添加到FormData
  if (startImageBase64) {
    const cleanBase64 = startImageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    
    // 调整图片尺寸以匹配视频尺寸要求
    console.log(`📐 调整参考图片尺寸至 ${VIDEO_WIDTH}x${VIDEO_HEIGHT}...`);
    const resizedBase64 = await resizeImageToSize(cleanBase64, VIDEO_WIDTH, VIDEO_HEIGHT);
    
    // 将base64转换为Blob
    const byteCharacters = atob(resizedBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });
    formData.append('input_reference', blob, 'reference.png');
    console.log('✅ 参考图片已调整尺寸并添加');
  }
  
  // 创建任务
  const createResponse = await proxyFetch(`${apiBase}/v1/videos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throwFromVideoHttpError(createResponse.status, errorText, 'sora');
  }
  
  const createData = await createResponse.json();
  // 响应格式可能是 { id: "sora-2:task_xxx" } 或 { task_id: "xxx" }
  const taskId = createData.id || createData.task_id;
  if (!taskId) {
    throw new Error('创建视频任务失败：未返回任务ID');
  }
  
  console.log('📋 sora-2任务已创建，任务ID:', taskId);
  
  // Step 2: 轮询查询任务状态
  const maxPollingTime = 1200000; // 20分钟超时
  const pollingInterval = 5000; // 每5秒查询一次
  const startTime = Date.now();
  
  let videoId: string | null = null;
  let completedStatus: Record<string, unknown> | null = null;

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
    
    const statusResponse = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!statusResponse.ok) {
      console.warn('⚠️ 查询任务状态失败，继续重试...');
      continue;
    }
    
    const statusData = await statusResponse.json();
    const status = statusData.status;
    
    console.log('🔄 sora-2任务状态:', status, '进度:', statusData.progress);
    
    if (status === 'completed' || status === 'succeeded') {
      completedStatus = statusData as Record<string, unknown>;
      videoId = resolveSoraVideoDownloadId(statusData as Record<string, unknown>);
      if (!videoId && statusData.outputs?.length) {
        const o0 = statusData.outputs[0];
        videoId = typeof o0 === 'string' ? o0 : o0?.id;
      }
      if (!videoId) {
        videoId = statusData.id || null;
      }
      // 部分网关 completed 首包 id 仍为 task_，再拉一次状态取 video_xxx（避免 /content 用 task_ 导致 502）
      if (videoId && String(videoId).startsWith('task_')) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const refresh = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          });
          if (refresh.ok) {
            const refreshed = await refresh.json();
            const v2 = resolveSoraVideoDownloadId(refreshed as Record<string, unknown>);
            if (v2 && v2.startsWith('video_')) {
              videoId = v2;
              console.log('✅ 刷新状态后使用视频资源 ID:', videoId);
            }
          }
        } catch (_) {
          /* 忽略刷新失败，仍用原 id 尝试下载 */
        }
      }
      console.log('✅ 任务完成，用于下载的 ID:', videoId);
      break;
    } else if (status === 'failed' || status === 'error') {
      const err = statusData.error;
      const errMsg = typeof err === 'string' ? err : (err?.message || err?.code || statusData.message || '未知错误');
      if (err?.code === 'moderation_blocked') {
        throw new Error(formatModerationBlockedForUser(err, 'sora'));
      }
      throw new Error(`视频生成失败: ${errMsg}`);
    }
    // 其他状态（pending, processing等）继续轮询
  }

  // 优先使用任务 JSON 中的直链（MinIO/S3 等），避免经 /api-proxy 请求 /content 导致 502
  const directUrl = completedStatus ? extractSoraDirectVideoUrl(completedStatus) : null;
  if (directUrl) {
    try {
      console.log('📥 使用任务返回的直链下载视频');
      const dataUrl = await fetchVideoUrlAsDataUrl(directUrl);
      console.log('✅ sora-2 视频已通过直链转为 base64');
      return dataUrl;
    } catch (e: any) {
      console.warn('⚠️ 直链下载失败（可能为跨域），将回退 /v1/videos/.../content:', e?.message);
    }
  }

  if (!videoId) {
    throw new Error('视频生成超时 (20分钟) 或未返回视频ID');
  }

  console.log('✅ sora-2视频生成完成，视频ID:', videoId);

  // Step 3: 下载视频内容（带重试和超时机制）
  const maxDownloadRetries = 5;
  const downloadTimeout = 600000; // 10分钟超时
  
  for (let attempt = 1; attempt <= maxDownloadRetries; attempt++) {
    try {
      console.log(`📥 尝试下载视频 (第${attempt}/${maxDownloadRetries}次)...`);
      
      const downloadController = new AbortController();
      const downloadTimeoutId = setTimeout(() => downloadController.abort(), downloadTimeout);
      
      const downloadResponse = await proxyFetch(`${apiBase}/v1/videos/${videoId}/content`, {
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: downloadController.signal
      });
      
      clearTimeout(downloadTimeoutId);
      
      if (!downloadResponse.ok) {
        // 502 且当前用的是 task_：再拉一次任务详情，尝试换成 video_ 后重试（避免误用 task id 调 /content）
        if (
          downloadResponse.status === 502 &&
          videoId &&
          String(videoId).startsWith('task_') &&
          attempt < maxDownloadRetries
        ) {
          try {
            const refresh = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
              method: 'GET',
              headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
            });
            if (refresh.ok) {
              const d = await refresh.json();
              const v2 = resolveSoraVideoDownloadId(d as Record<string, unknown>);
              if (v2 && v2.startsWith('video_')) {
                videoId = v2;
                console.warn('⚠️ 下载 502，已切换为 video_ 资源 ID 重试:', videoId);
                await new Promise((r) => setTimeout(r, 3000));
                continue;
              }
            }
          } catch (_) {
            /* fall through */
          }
        }
        if (downloadResponse.status >= 500 && attempt < maxDownloadRetries) {
          console.warn(`⚠️ 下载失败 HTTP ${downloadResponse.status}，${5 * attempt}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
          continue;
        }
        throw new Error(`下载视频失败: HTTP ${downloadResponse.status}`);
      }
      
      // 检查响应类型，可能直接返回视频blob或返回URL
      const contentType = downloadResponse.headers.get('content-type');
      
      if (contentType && contentType.includes('video')) {
        // 直接返回视频数据
        const videoBlob = await downloadResponse.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            console.log('✅ sora-2视频已转换为base64格式');
            resolve(result);
          };
          reader.onerror = () => reject(new Error('视频转base64失败'));
          reader.readAsDataURL(videoBlob);
        });
      } else {
        // 可能返回JSON包含URL
        const downloadData = await downloadResponse.json();
        const videoUrl = downloadData.url || downloadData.video_url || downloadData.download_url;
        
        if (!videoUrl) {
          throw new Error('未获取到视频下载地址');
        }
        
        // 下载并转换为base64
        const videoBase64 = await convertVideoUrlToBase64(videoUrl);
        console.log('✅ sora-2视频已转换为base64格式');
        return videoBase64;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`⚠️ 下载超时，${5 * attempt}秒后重试...`);
        if (attempt < maxDownloadRetries) {
          await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
          continue;
        }
        throw new Error('下载视频超时 (10分钟)');
      }
      // 其他错误在最后一次重试时抛出
      if (attempt === maxDownloadRetries) {
        throw error;
      }
      console.warn(`⚠️ 下载出错: ${error.message}，${5 * attempt}秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
  
  throw new Error('下载视频失败：已达最大重试次数');
};

/**
 * DashScope/千问视频生成（异步任务模式）
 * 流程：1. 创建任务 -> 2. 轮询状态 -> 3. 下载视频
 */

/**
 * DashScope/千问视频生成（异步任务模式）
 * 流程：1. 创建任务 -> 2. 轮询状态 -> 3. 下载视频
 */
const generateVideoWithDashScope = async (
  prompt: string,
  startImageBase64: string | undefined,
  apiKey: string,
  apiBase: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'qwen-video'
): Promise<string> => {
  console.log(`🎬 使用 DashScope 异步模式生成视频 (${modelName}, ${aspectRatio}, ${duration}秒)...`);

  const width = aspectRatio === '9:16' ? 720 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : 720;

  // Step 1: 创建视频任务
  const taskBody: any = {
    model: modelName,
    input: {
      prompt: prompt,
    },
    parameters: {
      size: `${width}x${height}`,
      duration: duration,
    },
  };

  if (startImageBase64) {
    taskBody.input.first_frame_image = startImageBase64;
  }

  const createResponse = await proxyFetch(`${apiBase}/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(taskBody),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`DashScope 创建视频任务失败: HTTP ${createResponse.status} - ${errorText}`);
  }

  const createData = await createResponse.json();
  const taskId = createData.output?.task_id || createData.task_id || createData.id;
  if (!taskId) {
    throw new Error('DashScope 创建视频任务失败：未返回任务ID');
  }

  console.log('📋 DashScope 任务已创建，任务ID:', taskId);

  // Step 2: 轮询查询任务状态
  const maxPollingTime = 1200000;
  const pollingInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));

    const statusResponse = await proxyFetch(`${apiBase}/v1/services/aigc/video-generation/video-synthesis/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      console.warn('⚠️ DashScope 查询任务状态失败，继续重试...');
      continue;
    }

    const statusData = await statusResponse.json();
    const status = statusData.output?.task_status || statusData.status;

    console.log('🔄 DashScope 任务状态:', status);

    if (status === 'SUCCEEDED' || status === 'succeeded' || status === 'completed') {
      const videoUrl = statusData.output?.video_url || statusData.output?.results?.video_url;
      if (!videoUrl) {
        throw new Error('DashScope 视频生成完成但未返回视频地址');
      }
      console.log('✅ DashScope 视频生成完成，开始下载...');
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ DashScope 视频已转换为base64格式');
      return videoBase64;
    } else if (status === 'FAILED' || status === 'failed' || status === 'error') {
      const errMsg = statusData.output?.message || statusData.message || '未知错误';
      throw new Error(`DashScope 视频生成失败: ${errMsg}`);
    }
    // 其他状态继续轮询
  }

  throw new Error('DashScope 视频生成超时 (20分钟)');
};

/**
 * 豆包视频生成（异步任务模式）
 * 流程：1. 创建任务 -> 2. 轮询状态 -> 3. 下载视频
 */
const generateVideoWithDoubao = async (
  prompt: string,
  startImageBase64: string | undefined,
  apiKey: string,
  apiBase: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'doubao-video',
  endpoint?: string
): Promise<string> => {
  console.log(`🎬 使用豆包异步模式生成视频 (${modelName}, ${aspectRatio}, ${duration}秒)...`);

  const width = aspectRatio === '9:16' ? 720 : (aspectRatio === '1:1' ? 720 : 1280);
  const height = aspectRatio === '9:16' ? 1280 : (aspectRatio === '1:1' ? 720 : 720);

  // Volcengine Ark video generation endpoint is /contents/generations/tasks
  const videoEndpoint = (apiBase.includes('volces.com') || modelName.includes('doubao'))
    ? '/contents/generations/tasks'
    : (endpoint || '/v1/videos/generations');

  const isVolcengine = videoEndpoint === '/contents/generations/tasks';
  
  let taskBody: any;
  if (isVolcengine) {
    // Volcengine Ark native task format
    let promptWithParams = prompt;
    if (aspectRatio === '9:16') {
      promptWithParams += ` --resolution 720p-portrait --duration ${duration}`;
    } else {
      promptWithParams += ` --resolution 720p --duration ${duration}`;
    }

    const content: any[] = [
      {
        type: 'text',
        text: promptWithParams
      }
    ];

    if (startImageBase64) {
      content.push({
        type: 'image_url',
        image_url: {
          url: startImageBase64
        }
      });
    }

    taskBody = {
      model: modelName,
      content: content
    };
  } else {
    // OpenAI-compatible format
    taskBody = {
      model: modelName,
      prompt: prompt,
      size: `${width}x${height}`,
      duration: duration,
    };
    if (startImageBase64) {
      taskBody.image_url = startImageBase64;
    }
  }

  const createResponse = await proxyFetch(`${apiBase}${videoEndpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(taskBody),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`豆包创建视频任务失败: HTTP ${createResponse.status} - ${errorText}`);
  }

  const createData = await createResponse.json();
  const taskId = createData.id || createData.task_id || createData.data?.task_id;
  if (!taskId) {
    throw new Error('豆包创建视频任务失败：未返回任务ID');
  }

  console.log('📋 豆包任务已创建，任务ID:', taskId);

  // Step 2: 轮询查询任务状态
  const maxPollingTime = 1200000;
  const pollingInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));

    const statusEndpoint = isVolcengine 
      ? `${videoEndpoint}/${taskId}` 
      : videoEndpoint.replace('/generations', `/generations/${taskId}`);

    const statusResponse = await proxyFetch(`${apiBase}${statusEndpoint}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      console.warn('⚠️ 豆包查询任务状态失败，继续重试...');
      continue;
    }

    const statusData = await statusResponse.json();
    const status = statusData.status || statusData.data?.status || statusData.output?.task_status;

    console.log('🔄 豆包任务状态:', status);

    if (status === 'succeeded' || status === 'completed' || status === 'done' || status === 'SUCCEEDED') {
      const videoUrl = statusData.content?.video_url || statusData.video_url || statusData.url || statusData.data?.video_url || statusData.output?.video_url;
      if (!videoUrl) {
        throw new Error('豆包视频生成完成但未返回视频地址');
      }
      console.log('✅ 豆包视频生成完成，开始下载...');
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ 豆包视频已转换为base64格式');
      return videoBase64;
    } else if (status === 'failed' || status === 'error' || status === 'FAILED') {
      const errMsg = statusData.error?.message || statusData.message || '未知错误';
      throw new Error(`豆包视频生成失败: ${errMsg}`);
    }
    // 其他状态继续轮询
  }

  throw new Error('豆包视频生成超时 (20分钟)');
};

/**
 * MiniMax H3 (海螺 3.0) 视频生成 - 官方 v2 异步任务 API
 * 创建: POST {v2}/video_generation  →  轮询: GET {v2}/query/video_generation/{task_id}
 * 支持文生视频、图生视频(首帧 first_frame),成功时从 task.content.url 取视频直链
 */
const resolveMiniMaxV2BaseURL = (baseURL: string): string => {
  const normalized = (baseURL || 'https://api.minimaxi.com/v1').replace(/\/+$/, '');
  if (normalized.endsWith('/v2')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized.slice(0, -3)}/v2`;
  return `${normalized}/v2`;
};

const generateVideoWithMiniMaxH3 = async (
  prompt: string,
  startImageBase64: string | undefined,
  apiKey: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'MiniMax-H3',
  apiBase: string
): Promise<string> => {
  console.log(`🎬 使用 MiniMax H3 生成视频 (${modelName}, ${aspectRatio}, ${duration}秒)...`);

  const v2Base = resolveMiniMaxV2BaseURL(apiBase);

  // 构造 content:文本 + 可选首帧(项目当前只传起始帧;H3 亦支持尾帧/参考图,后续可扩展)
  const content: any[] = [{ type: 'text', text: prompt }];

  const toH3ImageUrl = (img: string | undefined): string | undefined => {
    if (!img) return undefined;
    if (img.startsWith('http://') || img.startsWith('https://')) return img;
    const clean = img.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
    return `data:image/png;base64,${clean}`;
  };

  const firstFrame = toH3ImageUrl(startImageBase64);
  if (firstFrame) {
    content.push({ type: 'image_url', role: 'first_frame', image_url: { url: firstFrame } });
  }

  const body: any = {
    model: modelName,
    content,
    // 图生视频时用 adaptive,由模型自适应比例;纯文生视频用指定比例
    ratio: firstFrame ? 'adaptive' : aspectRatio,
    duration,
    resolution: '768P',
    aigc_watermark: false,
  };

  // Step 1: 创建视频任务
  const createResponse = await proxyFetch(`${v2Base}/video_generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`MiniMax H3 创建任务失败: HTTP ${createResponse.status} ${errorText.slice(0, 300)}`);
  }

  const createData = await createResponse.json();
  const taskId = createData.task_id;
  if (!taskId) {
    throw new Error('MiniMax H3 创建任务失败：未返回 task_id');
  }

  console.log('📋 MiniMax H3 任务已创建，任务ID:', taskId);

  // Step 2: 轮询查询任务状态
  const maxPollingTime = 1200000; // 20 分钟超时
  const pollingInterval = 5000; // 每 5 秒查询一次
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));

    const statusResponse = await proxyFetch(`${v2Base}/query/video_generation/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      console.warn('⚠️ MiniMax H3 查询任务状态失败，继续重试...');
      continue;
    }

    const statusData = await statusResponse.json();
    const task = statusData.task;
    if (!task) {
      console.warn('⚠️ MiniMax H3 状态响应缺少 task 字段，继续重试...');
      continue;
    }

    const status = task.status;
    console.log('🔄 MiniMax H3 任务状态:', status);

    if (status === 'succeeded') {
      const videoUrl = task.content?.url;
      if (!videoUrl) {
        throw new Error('MiniMax H3 生成成功但未返回视频 URL');
      }
      console.log('✅ MiniMax H3 生成完成，下载视频...');
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ MiniMax H3 视频已转换为 base64');
      return videoBase64;
    } else if (status === 'failed' || status === 'expired') {
      const taskError = typeof task.error === 'string' ? task.error : (task.error?.message || task.message);
      throw new Error(`MiniMax H3 视频生成失败: ${taskError || status}`);
    }
    // queued / running 继续轮询
  }

  throw new Error('MiniMax H3 视频生成超时 (20分钟)');
};

/**
 * 生成视频(Agent 8)
 * 使用antsk视频生成API (veo_3_1 或 sora-2)
 * 通过起始帧和结束帧生成视频片段
 * @param prompt - 视频生成提示词
 * @param startImageBase64 - 起始关键帧图像(base64格式)
 * @param endImageBase64 - 结束关键帧图像(base64格式)
 * @param model - 使用的视频生成模型，'veo' 会根据 aspectRatio 自动选择具体模型，'sora-2' 使用异步API
 * @param aspectRatio - 横竖屏比例，支持 '16:9'（横屏，默认）、'9:16'（竖屏）、'1:1'（方形，仅 sora-2 支持）
 * @param duration - 视频时长（仅 sora-2 支持），支持 4、8、12 秒
 * @returns 返回生成的视频base64编码(而非URL),用于存储到indexedDB
 * @throws 如果视频生成失败则抛出错误
 * @note 视频URL会过期,因此转换为base64存储
 * @note sora-2使用异步API模式(/v1/videos)，veo模型使用同步模式(/v1/chat/completions)
 */
export const generateVideo = async (
  prompt: string, 
  startImageBase64?: string, 
  endImageBase64?: string, 
  model: string = 'veo',
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8
): Promise<string> => {
  const resolvedVideoModel = resolveModel('video', model);
  const requestModel = resolveRequestModel('video', model) || model;
  const apiKey = checkApiKey('video', model);
  const apiBase = getApiBase('video', model);
  const isAsyncMode = (resolvedVideoModel?.params as any)?.mode === 'async' || requestModel === 'sora-2';
  const isQwenMode = (resolvedVideoModel?.params as any)?.mode === 'qwen';
  const isDoubaoMode = (resolvedVideoModel?.params as any)?.mode === 'doubao';
  const isH3Mode = (resolvedVideoModel?.params as any)?.mode === 'h3';
  
  // sora-2 使用异步API模式
  if (isAsyncMode) {
    return generateVideoWithSora2(prompt, startImageBase64, apiKey, aspectRatio, duration, requestModel || 'sora-2');
  }
  
  // 千问视频模型使用 DashScope 异步 API
  if (isQwenMode) {
    console.log(`🎬 使用千问视频生成模型 (${requestModel}, ${aspectRatio}, ${duration}秒)`);
    return generateVideoWithDashScope(prompt, startImageBase64, apiKey, apiBase, aspectRatio, duration, requestModel);
  }
  
  // 豆包视频模型使用火山引擎 API
  if (isDoubaoMode) {
    console.log(`🎬 使用豆包视频生成模型 (${requestModel}, ${aspectRatio}, ${duration}秒)`);
    return generateVideoWithDoubao(prompt, startImageBase64, apiKey, apiBase, aspectRatio, duration, requestModel, resolvedVideoModel?.endpoint);
  }

  // MiniMax H3 使用官方 v2 异步任务 API
  if (isH3Mode) {
    console.log(`🎬 使用 MiniMax H3 视频生成模型 (${requestModel}, ${aspectRatio}, ${duration}秒)`);
    return generateVideoWithMiniMaxH3(prompt, startImageBase64, apiKey, aspectRatio, duration, requestModel || 'MiniMax-H3', apiBase);
  }
  
  // 如果是 veo 模型，根据横竖屏和是否有参考图动态选择模型名称
  let actualModel = requestModel;
  if (actualModel === 'veo' || actualModel.startsWith('veo_3_1')) {
    const hasReferenceImage = !!startImageBase64;
    actualModel = getVeoModelName(hasReferenceImage, aspectRatio);
    console.log(`🎬 使用 Veo 模型: ${actualModel} (${aspectRatio})`);
    
    // Veo 不支持 1:1 方形视频
    if (aspectRatio === '1:1') {
      console.warn('⚠️ Veo 不支持方形视频 (1:1)，将使用横屏 (16:9)');
      actualModel = getVeoModelName(hasReferenceImage, '16:9');
    }
  }
  
  // Veo 模型使用同步模式 (/v1/chat/completions)
  // Clean base64 strings
  const cleanStart = startImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = endImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  // Build request body based on model requirements
  const messages: any[] = [
    { role: 'user', content: prompt }
  ];

  // Add images as content if provided
  if (cleanStart) {
    messages[0].content = [
      { type: 'text', text: prompt },
      { 
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${cleanStart}` }
      }
    ];
  }

  if (cleanEnd) {
    if (Array.isArray(messages[0].content)) {
      messages[0].content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${cleanEnd}` }
      });
    }
  }

  // Use non-streaming mode with increased timeout for video generation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes timeout

  try {
    const response = await retryOperation(async () => {
      const res = await proxyFetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          stream: false,
          temperature: 0.7
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorText = await res.text();
        throwFromVideoHttpError(res.status, errorText, 'veo');
      }

      return res;
    });

    clearTimeout(timeoutId);

    // Parse non-streaming response
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Look for video URL in the content
    const urlMatch = content.match(/(https?:\/\/[^\s]+\.mp4)/);
    const videoUrl = urlMatch ? urlMatch[1] : '';

    if (!videoUrl) {
      throw new Error("视频生成失败 (No video URL returned)");
    }

    console.log('🎬 视频URL获取成功,正在转换为base64...');
    
    // 将视频URL转换为base64,避免URL过期问题
    try {
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ 视频已转换为base64格式,可安全存储到IndexedDB');
      return videoBase64;
    } catch (error: any) {
      console.error('❌ 视频转base64失败,返回原始URL:', error);
      // 如果转换失败,返回原始URL作为降级方案
      return videoUrl;
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('视频生成超时 (20分钟)');
    }
    throw error;
  }
};

/**
 * AI续写功能 - 基于已有剧本内容续写后续情节
 * @param existingScript - 已有的剧本内容
 * @param language - 输出语言
 * @param model - 使用的AI模型
 * @returns 续写的内容
 */
export const continueScript = async (existingScript: string, language: string = '中文', model: string = 'gpt-5.1'): Promise<string> => {
  console.log('✍️ continueScript 调用 - 使用模型:', model);
  const startTime = Date.now();
  
  const prompt = `
你是一位资深剧本创作者。请在充分理解下方已有剧本内容的基础上，续写后续情节。

续写要求：
1. 严格保持原剧本的风格、语气、人物性格和叙事节奏，确保无明显风格断层。
2. 情节发展需自然流畅，逻辑严密，因果关系合理，避免突兀转折。
3. 有效增加戏剧冲突和情感张力，使故事更具吸引力和张力。
4. 续写内容应为原有剧本长度的30%-50%，字数适中，避免过短或过长。
5. 保持剧本的原有格式，包括场景描述、人物对白、舞台指示等，确保格式一致。
6. 输出语言为：${language}，用词准确、表达流畅。
7. 仅输出续写剧本内容，不添加任何说明、前缀或后缀。

已有剧本内容：
${existingScript}

请直接续写剧本内容。（不要包含"续写："等前缀）：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.8, 4096));
    const duration = Date.now() - startTime;
    
    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'continue-script',
      resourceName: 'AI续写剧本',
      status: 'success',
      model,
      duration,
      prompt: existingScript.substring(0, 200) + '...'
    });
    
    return result;
  } catch (error) {
    console.error('❌ 续写失败:', error);
    throw error;
  }
};

/**
 * AI续写功能（流式）- 基于已有剧本内容续写后续情节
 * @param existingScript - 已有的剧本内容
 * @param language - 输出语言
 * @param model - 使用的AI模型
 * @param onDelta - 流式增量回调
 * @returns 续写的完整内容
 */
export const continueScriptStream = async (
  existingScript: string,
  language: string = '中文',
  model: string = 'gpt-5.1',
  onDelta?: (delta: string) => void
): Promise<string> => {
  console.log('✍️ continueScriptStream 调用 - 使用模型:', model);
  const startTime = Date.now();

  const prompt = `
你是一位资深剧本创作者。请在充分理解下方已有剧本内容的基础上，续写后续情节。

续写要求：
1. 严格保持原剧本的风格、语气、人物性格和叙事节奏，确保无明显风格断层。
2. 情节发展需自然流畅，逻辑严密，因果关系合理，避免突兀转折。
3. 有效增加戏剧冲突和情感张力，使故事更具吸引力和张力。
4. 续写内容应为原有剧本长度的30%-50%，字数适中，避免过短或过长。
5. 保持剧本的原有格式，包括场景描述、人物对白、舞台指示等，确保格式一致。
6. 输出语言为：${language}，用词准确、表达流畅。
7. 仅输出续写剧本内容，不添加任何说明、前缀或后缀。

已有剧本内容：
${existingScript}

请直接续写剧本内容。（不要包含"续写："等前缀）：
`;

  try {
    const result = await retryOperation(() => chatCompletionStream(prompt, model, 0.8, undefined, 600000, onDelta));
    const duration = Date.now() - startTime;

    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'continue-script',
      resourceName: 'AI续写剧本（流式）',
      status: 'success',
      model,
      duration,
      prompt: existingScript.substring(0, 200) + '...'
    });

    return result;
  } catch (error) {
    console.error('❌ 续写失败（流式）:', error);
    throw error;
  }
};

/**
 * AI改写功能 - 对整个剧本进行改写，让情节更连贯
 * @param originalScript - 原始剧本内容
 * @param language - 输出语言
 * @param model - 使用的AI模型
 * @returns 改写后的完整剧本
 */
export const rewriteScript = async (originalScript: string, language: string = '中文', model?: string): Promise<string> => {
  const finalModel = model || resolveRequestModel('chat') || 'qwen-max';
  console.log('🔄 rewriteScript 调用 - 使用模型:', finalModel);
  const startTime = Date.now();
  
  const prompt = `
你是一位顶级剧本编剧顾问，擅长提升剧本的结构、情感和戏剧张力。请对下方提供的剧本进行系统性、创造性改写，目标是使剧本在连贯性、流畅性和戏剧冲突等方面显著提升。

改写具体要求如下：

1. 保留原剧本的核心故事线和主要人物设定，不改变故事主旨。
2. 优化情节结构，确保事件发展具有清晰的因果关系，逻辑严密。
3. 增强场景之间的衔接与转换，使整体叙事流畅自然。
4. 丰富和提升人物对话，使其更具个性、情感色彩和真实感，避免生硬或刻板。
5. 强化戏剧冲突，突出人物之间的矛盾与情感张力，增加情节的吸引力和感染力。
6. 深化人物内心活动和情感描写，提升剧本的情感深度。
7. 优化整体节奏，合理分配高潮与缓和段落，避免情节拖沓或推进过快。
8. 保持或适度增加剧本内容长度，确保内容充实但不过度冗长。
9. 严格遵循剧本格式规范，包括场景标注、人物台词、舞台指示等。
10. 输出语言为：${language}，确保语言风格与剧本类型相符。

原始剧本内容如下：
${originalScript}

请根据以上要求，输出经过全面改写、结构优化、情感丰富的完整剧本文本。
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, finalModel, 0.7, 8192));
    const duration = Date.now() - startTime;
    
    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'rewrite-script',
      resourceName: 'AI改写剧本',
      status: 'success',
      model: finalModel,
      duration,
      prompt: originalScript.substring(0, 200) + '...'
    });
    
    return result;
  } catch (error) {
    console.error('❌ 改写失败:', error);
    throw error;
  }
};

/**
 * AI改写功能（流式）- 对整个剧本进行改写，让情节更连贯
 * @param originalScript - 原始剧本内容
 * @param language - 输出语言
 * @param model - 使用的AI模型
 * @param onDelta - 流式增量回调
 * @returns 改写后的完整剧本
 */
export const rewriteScriptStream = async (
  originalScript: string,
  language: string = '中文',
  model?: string,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const finalModel = model || resolveRequestModel('chat') || 'qwen-max';
  console.log('🔄 rewriteScriptStream 调用 - 使用模型:', finalModel);
  const startTime = Date.now();

  const prompt = `
你是一位顶级剧本编剧顾问，擅长提升剧本的结构、情感和戏剧张力。请对下方提供的剧本进行系统性、创造性改写，目标是使剧本在连贯性、流畅性和戏剧冲突等方面显著提升。

改写具体要求如下：

1. 保留原剧本的核心故事线和主要人物设定，不改变故事主旨。
2. 优化情节结构，确保事件发展具有清晰的因果关系，逻辑严密。
3. 增强场景之间的衔接与转换，使整体叙事流畅自然。
4. 丰富和提升人物对话，使其更具个性、情感色彩和真实感，避免生硬或刻板。
5. 强化戏剧冲突，突出人物之间的矛盾与情感张力，增加情节的吸引力和感染力。
6. 深化人物内心活动和情感描写，提升剧本的情感深度。
7. 优化整体节奏，合理分配高潮与缓和段落，避免情节拖沓或推进过快。
8. 保持或适度增加剧本内容长度，确保内容充实但不过度冗长。
9. 严格遵循剧本格式规范，包括场景标注、人物台词、舞台指示等。
10. 输出语言为：${language}，确保语言风格与剧本类型相符。

原始剧本内容如下：
${originalScript}

请根据以上要求，输出经过全面改写、结构优化、情感丰富的完整剧本文本。
`;

  try {
    const result = await retryOperation(() => chatCompletionStream(prompt, finalModel, 0.7, undefined, 600000, onDelta));
    const duration = Date.now() - startTime;

    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'rewrite-script',
      resourceName: 'AI改写剧本（流式）',
      status: 'success',
      model: finalModel,
      duration,
      prompt: originalScript.substring(0, 200) + '...'
    });

    return result;
  } catch (error) {
    console.error('❌ 改写失败（流式）:', error);
    throw error;
  }
};

/**
 * AI一次性优化起始帧和结束帧视觉描述（推荐使用）
 * 根据场景信息和叙事动作，同时生成起始帧和结束帧的详细视觉描述
 * 相比单独优化，这个方法能让AI更好地理解两帧的关系，确保视觉过渡更协调
 * @param actionSummary - 叙事动作描述
 * @param cameraMovement - 镜头运动
 * @param sceneInfo - 场景信息（地点、时间、氛围）
 * @param characterInfo - 角色信息（可选）
 * @param visualStyle - 视觉风格
 * @param model - 使用的模型，默认'gpt-5.1'
 * @returns 返回包含起始帧和结束帧的优化描述对象
 */
export const optimizeBothKeyframes = async (
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model: string = 'gpt-5.1'
): Promise<{ startPrompt: string; endPrompt: string }> => {
  console.log('🎨 optimizeBothKeyframes 调用 - 同时优化起始帧和结束帧 - 使用模型:', model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': '真人实拍电影风格，photorealistic，8K高清，专业摄影',
    'anime': '日本动漫风格，cel-shaded，鲜艳色彩，Studio Ghibli品质',
    '3d-animation': '3D CGI动画，Pixar/DreamWorks风格，精细材质',
    'cyberpunk': '赛博朋克美学，霓虹灯光，未来科技感',
    'oil-painting': '油画风格，可见笔触，古典艺术构图'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
你是一位专业的电影视觉导演和概念艺术家。请为以下镜头同时创作起始帧和结束帧的详细视觉描述。

## 场景信息
**地点：** ${sceneInfo.location}
**时间：** ${sceneInfo.time}
**氛围：** ${sceneInfo.atmosphere}

## 叙事动作
${actionSummary}

## 镜头运动
${cameraMovement}

## 角色信息
${characterInfo.length > 0 ? characterInfo.join('、') : '无特定角色'}

## 视觉风格
${styleDesc}

## 任务要求

你需要为这个8-10秒的镜头创作**起始帧**和**结束帧**两个关键画面的视觉描述。

### 起始帧要求：
• 建立清晰的初始场景和人物状态
• 为即将发生的动作预留视觉空间和动势
• 设定光影和色调基调
• 展现角色的起始表情、姿态和位置
• 根据镜头运动（${cameraMovement}）设置合适的初始构图
• 营造场景氛围，让观众明确故事的起点

### 结束帧要求：
• 展现动作完成后的最终状态和结果
• 体现镜头运动（${cameraMovement}）带来的视角和构图变化
• 展现角色的情绪变化、最终姿态和位置
• 可以有戏剧性的光影和色彩变化
• 达到视觉高潮或情绪释放点
• 为下一个镜头的衔接做准备

### 两帧协调性：
⚠️ **关键**：起始帧和结束帧必须在视觉上连贯协调
- 保持一致的视觉风格和色调基础
- 镜头运动轨迹要清晰可推导
- 人物/物体的空间位置变化要合理
- 光影变化要有逻辑性
- 两帧描述应该能够自然串联成一个流畅的视觉叙事

### 每帧必须包含的视觉元素：

**1. 构图与景别**
- 根据镜头运动确定画面框架和视角
- 主体在画面中的位置和大小
- 前景、中景、背景的层次关系

**2. 光影与色彩**
- 光源的方向、强度和色温
- 主光、辅光、轮廓光的配置
- 整体色调和色彩情绪（暖色/冷色）
- 阴影的长度和密度

**3. 角色细节**（如有）
- 面部表情和眼神方向
- 肢体姿态和重心分布
- 服装状态和细节
- 与环境的互动关系

**4. 环境细节**
- 场景的具体视觉元素
- 环境氛围（雾气、光束、粒子等）
- 背景的清晰度和景深效果
- 环境对叙事的支持

**5. 运动暗示**
- 动态模糊或静止清晰
- 运动方向的视觉引导
- 张力和动势的体现

**6. 电影感细节**
- 画面质感和材质
- 大气透视效果
- 电影级的视觉特征

## 输出格式

请按以下JSON格式输出（注意：描述文本用中文，每个约100-150字）：

\`\`\`json
{
  "startFrame": "起始帧的详细视觉描述...",
  "endFrame": "结束帧的详细视觉描述..."
}
\`\`\`

❌ 避免：
- 不要在描述中包含"Visual Style:"等标签
- 不要分段或使用项目符号
- 不要过于技术化的术语
- 不要描述整个动作过程，只描述画面本身

✅ 追求：
- 流畅的单段描述
- 富有画面感的语言
- 两帧描述相互呼应、逻辑连贯
- 与叙事动作和镜头运动协调一致
- 具体、可视觉化的细节

请开始创作：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 2048, 'json_object'));
    const duration = Date.now() - startTime;
    
    // 解析JSON响应
    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.startFrame || !parsed.endFrame) {
      throw new Error('AI返回的JSON格式不正确');
    }
    
    console.log('✅ AI同时优化起始帧和结束帧成功，耗时:', duration, 'ms');
    
    return {
      startPrompt: parsed.startFrame.trim(),
      endPrompt: parsed.endFrame.trim()
    };
  } catch (error: any) {
    console.error('❌ AI关键帧优化失败:', error);
    throw new Error(`AI关键帧优化失败: ${error.message}`);
  }
};

/**
 * AI优化单个关键帧视觉描述（兼容旧版，建议使用 optimizeBothKeyframes）
 * 根据场景信息和叙事动作，生成详细的起始帧或结束帧视觉描述
 * @param frameType - 帧类型 'start' 或 'end'
 * @param actionSummary - 叙事动作描述
 * @param cameraMovement - 镜头运动
 * @param sceneInfo - 场景信息（地点、时间、氛围）
 * @param characterInfo - 角色信息（可选）
 * @param visualStyle - 视觉风格
 * @param model - 使用的模型，默认'gpt-5.1'
 * @returns 返回AI优化后的关键帧视觉描述
 */
export const optimizeKeyframePrompt = async (
  frameType: 'start' | 'end',
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model: string = 'gpt-5.1'
): Promise<string> => {
  console.log(`🎨 optimizeKeyframePrompt 调用 - ${frameType === 'start' ? '起始帧' : '结束帧'} - 使用模型:`, model);
  const startTime = Date.now();

  const frameLabel = frameType === 'start' ? '起始帧' : '结束帧';
  const frameFocus = frameType === 'start' 
    ? '初始状态、起始姿态、预备动作、场景建立'
    : '最终状态、结束姿态、动作完成、情绪高潮';

  const stylePrompts: { [key: string]: string } = {
    'live-action': '真人实拍电影风格，photorealistic，8K高清，专业摄影',
    'anime': '日本动漫风格，cel-shaded，鲜艳色彩，Studio Ghibli品质',
    '3d-animation': '3D CGI动画，Pixar/DreamWorks风格，精细材质',
    'cyberpunk': '赛博朋克美学，霓虹灯光，未来科技感',
    'oil-painting': '油画风格，可见笔触，古典艺术构图'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
你是一位专业的电影视觉导演和概念艺术家。请为以下镜头的${frameLabel}创作详细的视觉描述。

## 场景信息
**地点：** ${sceneInfo.location}
**时间：** ${sceneInfo.time}
**氛围：** ${sceneInfo.atmosphere}

## 叙事动作
${actionSummary}

## 镜头运动
${cameraMovement}

## 角色信息
${characterInfo.length > 0 ? characterInfo.join('、') : '无特定角色'}

## 视觉风格
${styleDesc}

## 任务要求

作为${frameLabel}，你需要重点描述：**${frameFocus}**

### ${frameType === 'start' ? '起始帧' : '结束帧'}特殊要求：
${frameType === 'start' ? `
• 建立清晰的初始场景和人物状态
• 为即将发生的动作预留视觉空间和动势
• 设定光影和色调基调
• 展现角色的起始表情、姿态和位置
• 根据镜头运动（${cameraMovement}）设置合适的初始构图
• 营造场景氛围，让观众明确故事的起点
` : `
• 展现动作完成后的最终状态和结果
• 体现镜头运动（${cameraMovement}）带来的视角和构图变化
• 展现角色的情绪变化、最终姿态和位置
• 可以有戏剧性的光影和色彩变化
• 达到视觉高潮或情绪释放点
• 为下一个镜头的衔接做准备
`}

### 必须包含的视觉元素：

**1. 构图与景别**
- 根据镜头运动确定画面框架和视角
- 主体在画面中的位置和大小
- 前景、中景、背景的层次关系

**2. 光影与色彩**
- 光源的方向、强度和色温
- 主光、辅光、轮廓光的配置
- 整体色调和色彩情绪（暖色/冷色）
- 阴影的长度和密度

**3. 角色细节**（如有）
- 面部表情和眼神方向
- 肢体姿态和重心分布
- 服装状态和细节
- 与环境的互动关系

**4. 环境细节**
- 场景的具体视觉元素
- 环境氛围（雾气、光束、粒子等）
- 背景的清晰度和景深效果
- 环境对叙事的支持

**5. 运动暗示**
- 动态模糊或静止清晰
- 运动方向的视觉引导
- 张力和动势的体现

**6. 电影感细节**
- 画面质感和材质
- 大气透视效果
- 电影级的视觉特征

## 输出格式

请直接输出简洁但详细的视觉描述，约100-150字，用中文。

❌ 避免：
- 不要包含"Visual Style:"等标签
- 不要分段或使用项目符号
- 不要过于技术化的术语
- 不要描述整个动作过程，只描述这一帧的画面

✅ 追求：
- 流畅的单段描述
- 富有画面感的语言
- 突出${frameLabel}的特点
- 与叙事动作和镜头运动协调一致
- 具体、可视觉化的细节

请开始创作这一帧的视觉描述：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
    const duration = Date.now() - startTime;
    
    console.log(`✅ AI ${frameLabel}优化成功，耗时:`, duration, 'ms');
    
    return result.trim();
  } catch (error: any) {
    console.error(`❌ AI ${frameLabel}优化失败:`, error);
    throw new Error(`AI ${frameLabel}优化失败: ${error.message}`);
  }
};

/**
 * AI生成叙事动作建议
 * 根据首帧和尾帧信息，结合高质量动作提示词参考，生成适合场景的动作
 * @param startFramePrompt - 首帧提示词
 * @param endFramePrompt - 尾帧提示词
 * @param cameraMovement - 镜头运动
 * @param model - 使用的模型，默认'gpt-5.1'
 * @returns 返回AI生成的动作建议
 */
export const generateActionSuggestion = async (
  startFramePrompt: string,
  endFramePrompt: string,
  cameraMovement: string,
  model: string = 'gpt-5.1'
): Promise<string> => {
  console.log('🎬 generateActionSuggestion 调用 - 使用模型:', model);
  const startTime = Date.now();

  const actionReferenceExamples = `
## 高质量动作提示词参考示例

### 特效魔法戏示例
与男生飞在空中，随着抬起手臂，镜头迅速拉远到大远景，天空不断劈下密密麻麻的闪电，男生的机甲化作蓝光，形成一个压迫感拉满，巨大的魔法冲向镜头，震撼感和压迫感拉满。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 打斗戏示例
面具人和白发男生赤手空拳展开肉搏，他们会使用魔法。要求拥有李小龙、成龙级别的打斗动作。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 蓄力攻击示例
机甲蓄力，朝天空猛开几炮，震撼感和压迫感拉满。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 魔法展开示例
男生脚下的地面突然剧烈震动，一根根粗壮的石刺破土而出如同怪兽的獠牙，压迫感拉满，疯狂地朝他刺来(给石刺特写)！男生快速跃起，同时双手在胸前合拢。眼睛散发出蓝色的魔法光芒，大喊：领域展开·无尽冰原！嗡！一股肉眼可见的蓝色波纹瞬间扩散开来，所过之处，无论是地面、墙壁全都被一层厚厚的坚冰覆盖！整个仓库还是废弃的集装箱，瞬间变成了一片光滑的溜冰场！石刺也被冻住。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 快速移动示例
镜头1：天台左侧中景，郑一剑初始站立，背后是夜色笼罩下灯火闪烁的城市，圆月高悬。他保持着一种蓄势待发的静态站立姿态，周身氛围沉静。
镜头2：郑一剑消失："模糊拖影"特效与空气扰动，画面瞬间触发"模糊拖影"特效，身影如被快速拉扯的幻影般，以极快的速度淡化、消失，原地只残留极其轻微的空气扰动波纹。
镜头3：镜头急速移至曲飞面前，从郑一剑消失的位置，以迅猛的速度横向移动，画面里天台的栏杆、地面等景物飞速掠过，产生强烈的动态模糊效果。最终镜头定格在曲飞面前，脸上露出明显的惊讶与警惕。
镜头4：郑一剑突然出现准备出拳，毫无征兆地出现在画面中央，身体大幅度前倾，呈现出极具张力的准备出拳姿势，右手紧紧握拳，带起的劲风使得衣角大幅度向后飘动。

### 能量爆发示例
镜头在倾盆大雨中快速抖动向前推进，对准在黑暗海平面中屹立不动的黑影。几道闪电快速划过，轮廓在雨幕中若隐若现。突然，一股巨大的雷暴能量在他身后快速汇聚，光芒猛烈爆发。镜头立刻快速向地面猛冲，并同时向上极度仰起，锁定他被能量光芒完全照亮的、张开双臂的威严姿态。
`;

  const prompt = `
你是一位专业的电影动作导演和叙事顾问。请根据提供的首帧和尾帧信息，结合镜头运动，设计一个既符合叙事逻辑又充满视觉冲击力的动作场景。

## 重要约束
⏱️ **时长限制**：这是一个8-10秒的单镜头场景，请严格控制动作复杂度
📹 **镜头要求**：这是一个连续镜头，不要设计多个镜头切换（除非绝对必要，最多2-3个快速切换）

## 输入信息
**首帧描述：** ${startFramePrompt}
**尾帧描述：** ${endFramePrompt}
**镜头运动：** ${cameraMovement}

${actionReferenceExamples}

## 任务要求
1. **时长适配**：动作设计必须在8-10秒内完成，避免过于复杂的多步骤动作
2. **单镜头思维**：优先设计一个连贯的镜头内动作，而非多镜头组合
3. **自然衔接**：动作需要自然地从首帧过渡到尾帧，确保逻辑合理
4. **风格借鉴**：参考上述示例的风格和语言，但要简化步骤：
   - 富有张力但简洁的描述语言
   - 强调关键的视觉冲击点
   - 电影级的运镜描述但避免过度分解
5. **创新适配**：不要重复已有提示词，结合当前场景创新
6. **镜头语言**：根据提供的镜头运动（${cameraMovement}），设计相应的运镜方案

## 输出格式
请直接输出动作描述文本，无需JSON格式或额外标记。内容应包含：
- 简洁的单镜头动作场景描述（不要"镜头1、镜头2..."的分段，除非场景确实需要快速切换）
- 关键的运镜说明（推拉摇移等）
- 核心的视觉特效或情感氛围
- 确保描述具有电影感但控制篇幅

❌ 避免：过多的镜头切换、冗长的分步描述、超过10秒的复杂动作序列
✅ 追求：精炼、有冲击力、符合8-10秒时长的单镜头动作

请开始创作：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.8, 2048));
    const duration = Date.now() - startTime;
    
    console.log('✅ AI动作生成成功，耗时:', duration, 'ms');
    
    return result.trim();
  } catch (error: any) {
    console.error('❌ AI动作生成失败:', error);
    throw new Error(`AI动作生成失败: ${error.message}`);
  }
};

/**
 * 将视频提示词改写为更易通过平台内容审核的版本（弱化暴力、血腥、敏感表述，保留氛围与剧情）
 * @param videoPrompt - 原始视频生成提示词（完整段落）
 * @param model - 使用的对话模型 id，默认使用当前激活的 chat 模型
 * @returns 改写后的提示词，可直接用于再次请求视频生成
 */
export const rewritePromptForModeration = async (
  videoPrompt: string,
  model?: string
): Promise<string> => {
  const chatModel = model || getActiveChatModel()?.apiModel || getActiveChatModel()?.id || 'gpt-4o';
  const prompt = `
你是一位专业的影视剧本审稿与合规顾问。下面是一段用于 AI 视频生成的镜头描述，因涉及暴力、血腥或敏感表述被平台内容审核拦截。

请在不改变场景氛围、剧情走向和镜头意图的前提下，对描述进行「温和化」改写：
- 将直接描写暴力、血腥、尸骨、残肢等改为含蓄或氛围化表述（如：古战场遗迹、荒凉、肃杀、风沙中的残破兵甲等）
- 保留：时间、地点、角色动作、镜头运动、光影与情绪
- 输出语言与原文一致（中文则中文）
- 只输出改写后的完整提示词正文，不要加「改写如下」等前缀或任何解释

## 原始提示词
${videoPrompt}

## 改写后的提示词（仅正文）
`;
  const result = await retryOperation(() => chatCompletion(prompt, chatModel, 0.5, 4096));
  return result.trim();
};

/**
 * AI镜头拆分功能 - 将单个镜头拆分为多个细致的子镜头
 * 根据动作描述，按照景别（全景、中景、特写）和视角拆分镜头
 * @param shot - 原始镜头对象
 * @param sceneInfo - 场景信息（地点、时间、氛围）
 * @param characterNames - 角色名称数组
 * @param visualStyle - 视觉风格
 * @param model - 使用的模型，默认'gpt-5.1'
 * @returns 返回包含子镜头数组的对象
 */
export const splitShotIntoSubShots = async (
  shot: any, // Shot type from types.ts
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterNames: string[],
  visualStyle: string,
  model: string = 'gpt-5.1'
): Promise<{ subShots: any[] }> => {
  console.log('✂️ splitShotIntoSubShots 调用 - 使用模型:', model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': '真人实拍电影风格',
    'anime': '日本动漫风格',
    '3d-animation': '3D CGI动画风格',
    'cyberpunk': '赛博朋克风格',
    'oil-painting': '油画艺术风格'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
你是一位专业的电影分镜师和导演。你的任务是将一个粗略的镜头描述，拆分为多个细致、专业的子镜头。

## 原始镜头信息

**场景地点：** ${sceneInfo.location}
**场景时间：** ${sceneInfo.time}
**场景氛围：** ${sceneInfo.atmosphere}
**角色：** ${characterNames.length > 0 ? characterNames.join('、') : '无特定角色'}
**视觉风格：** ${styleDesc}
**原始镜头运动：** ${shot.cameraMovement || '未指定'}

**原始动作描述：**
${shot.actionSummary}

${shot.dialogue ? `**对白：** "${shot.dialogue}"

⚠️ **对白处理说明**：原始镜头包含对白。请在拆分时，将对白放在最合适的子镜头中（通常是角色说话的中景或近景镜头），并在该子镜头的actionSummary中明确提及对白内容。其他子镜头不需要包含对白。` : ''}

## 拆分要求

### 核心原则
1. **单一职责**：每个子镜头只负责一个视角或动作细节，避免混合多个视角
2. **时长控制**：每个子镜头时长约2-4秒，总时长保持在8-10秒左右
3. **景别多样化**：合理运用全景、中景、特写等不同景别
4. **连贯性**：子镜头之间要有逻辑的视觉过渡和叙事连贯性

### 拆分维度示例

**景别分类（Shot Size）：**
- **远景 Long Shot / 全景 Wide Shot**：展示整体环境、人物位置关系、空间布局
- **中景 Medium Shot**：展示人物上半身或腰部以上，强调动作和表情
- **近景 Close-up**：展示人物头部或重要物体，强调情感和细节
- **特写 Extreme Close-up**：聚焦关键细节（如手部动作、眼神、物体特写）

**拆分策略：**
- 如果原始描述是"我在书房走向书桌坐下来，打开电脑"，应拆分为：
  1. 全景：展示我从书房门口走向书桌的整体环境
  2. 中景：我走到椅子前准备坐下的动作
  3. 特写：我坐下时身体与椅子接触的瞬间
  4. 近景：我伸手按下电脑开机键或打开笔记本盖

- 如果原始描述是连续的打斗动作，应从不同视角拆分：
  1. 远景：展示双方对峙的整体画面
  2. 中景：第一次攻击动作
  3. 特写：拳头或武器的碰撞细节
  4. 近景：角色面部反应

### 必须包含的字段

每个子镜头必须包含以下信息：

1. **shotSize**（景别）：明确标注景别类型（全景、中景、特写等）
2. **cameraMovement**（镜头运动）：描述镜头如何移动（静止、推进、跟踪、环绕等）
3. **actionSummary**（动作描述）：清晰、具体的动作和画面内容描述（60-100字）
4. **visualFocus**（视觉焦点）：这个镜头的视觉重点是什么（如"人物移动轨迹"、"手部特写"、"面部表情变化"等）
5. **keyframes**（关键帧数组）：包含起始帧(start)和结束帧(end)的视觉描述
   - 每个关键帧必须包含：
     - **type**: "start" 或 "end"
     - **visualPrompt**: 详细的画面视觉描述（用于AI图像生成），包含场景、人物、光影、构图等细节（100-150字）

### 专业镜头运动参考

可从以下类型中选择或自定义：
- 静止镜头 Static Shot
- 推镜头 Dolly Shot / 拉镜头 Zoom Out
- 跟踪镜头 Tracking Shot
- 平移镜头 Pan Shot
- 环绕镜头 Circular Shot
- 俯视镜头 High Angle / 仰视镜头 Low Angle
- 主观视角 POV Shot
- 越肩镜头 Over the Shoulder

## 输出格式

请输出JSON格式，结构如下：

\`\`\`json
{
  "subShots": [
    {
      "shotSize": "全景 Wide Shot",
      "cameraMovement": "静止镜头 Static Shot",
      "actionSummary": "镜头从书房门口的角度，展示整个书房空间，我从门口缓步走向位于房间中央的书桌，背景可见书架、窗户和温暖的灯光。",
      "visualFocus": "整体环境布局和人物移动轨迹",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "书房全景，${styleDesc}，我站在门口，身体朝向书桌方向，准备迈步。房间中央是深色木质书桌，背后是装满书籍的书架，窗户透进柔和的自然光，营造温馨的学习氛围。构图采用三分法，人物位于左侧，书桌位于画面中心。"
        },
        {
          "type": "end",
          "visualPrompt": "书房全景，${styleDesc}，我已走到书桌旁边，身体靠近椅子，手即将触碰椅背。画面保持整体环境视角，展示完整的移动轨迹。光线保持一致，强调空间的纵深感。"
        }
      ]
    },
    {
      "shotSize": "中景 Medium Shot",
      "cameraMovement": "跟踪镜头 Tracking Shot",
      "actionSummary": "镜头跟随我走到书桌前，拍摄腰部以上，我伸手拉开椅子，身体微微前倾准备坐下。",
      "visualFocus": "人物上半身动作和与椅子的互动",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "中景人物镜头，${styleDesc}，拍摄腰部以上，我正在接近书桌，手臂自然摆动，表情专注。背景虚化的书架和窗户，突出人物主体。侧面光勾勒人物轮廓。"
        },
        {
          "type": "end",
          "visualPrompt": "中景人物镜头，${styleDesc}，我的手已抓住椅背，身体微微前倾，准备坐下的姿态。表情放松，眼神看向座位。背景保持虚化，强调动作细节。"
        }
      ]
    },
    {
      "shotSize": "特写 Close-up",
      "cameraMovement": "静止镜头 Static Shot",
      "actionSummary": "特写镜头聚焦在我的臀部和椅子座面，捕捉我坐下的瞬间，椅子轻微下沉的动作。",
      "visualFocus": "身体与椅子接触的细节瞬间",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "特写镜头，${styleDesc}，聚焦椅子座面和我即将坐下的臀部位置，椅子为深色皮革材质，反射柔和光线。身体正在下降，距离椅面约10厘米。浅景深，背景完全虚化。"
        },
        {
          "type": "end",
          "visualPrompt": "特写镜头，${styleDesc}，身体已完全坐在椅子上，座面轻微凹陷，皮革产生自然的皱褶。捕捉接触瞬间的微妙变化，展现材质质感和重量感。"
        }
      ]
    },
    {
      "shotSize": "近景 Close Shot",
      "cameraMovement": "推镜头 Dolly In",
      "actionSummary": "镜头从侧面推进，拍摄我端坐在椅子上，手伸向电脑，按下开机键，屏幕亮起微光照亮脸部。",
      "visualFocus": "手部按键动作和屏幕亮起的瞬间",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "近景侧面镜头，${styleDesc}，我端坐在椅子上，上半身和电脑在画面中。手臂伸向笔记本电脑，手指即将触碰键盘或电源键。电脑屏幕暗黑，面部被环境光照亮，表情期待。"
        },
        {
          "type": "end",
          "visualPrompt": "近景侧面镜头，${styleDesc}，镜头推进更近，手指已按下开机键，屏幕亮起柔和的蓝白色光芒，照亮我的脸部轮廓和手部。表情专注，眼神看向屏幕，营造科技氛围。"
        }
      ]
    }
  ]
}
\`\`\`

**关键帧visualPrompt要求**：
- 必须包含视觉风格标记（${styleDesc}）
- 详细描述画面构图、光影、色彩、景深等视觉元素
- 起始帧和结束帧要有明显的视觉差异，体现动作过程
- 长度控制在100-150字，既详细又不过于冗长
- 使用专业的摄影和美术术语

## 重要提示

❌ **避免：**
- 不要在单个子镜头中混合多个视角或景别
- 不要拆分过细导致总时长超过10秒
- 不要使用过于技术化或晦涩的术语
- 不要忽略视觉连贯性

✅ **追求：**
- 每个子镜头职责清晰、画面感强
- 景别和视角多样化但符合叙事逻辑
- 动作描述具体、可执行
- 保持电影级的专业表达

请开始拆分，直接输出JSON格式（不要包含markdown代码块标记）：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 4096, 'json_object'));
    const duration = Date.now() - startTime;
    
    // 清理和解析JSON
    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.subShots || !Array.isArray(parsed.subShots) || parsed.subShots.length === 0) {
      throw new Error('AI返回的JSON格式不正确或子镜头数组为空');
    }
    
    // 验证每个子镜头包含必需字段
    for (const subShot of parsed.subShots) {
      if (!subShot.shotSize || !subShot.cameraMovement || !subShot.actionSummary || !subShot.visualFocus) {
        throw new Error('子镜头缺少必需字段（shotSize、cameraMovement、actionSummary、visualFocus）');
      }
      
      // 验证关键帧数组
      if (!subShot.keyframes || !Array.isArray(subShot.keyframes) || subShot.keyframes.length === 0) {
        throw new Error('子镜头缺少关键帧数组（keyframes）');
      }
      
      // 验证每个关键帧
      for (const kf of subShot.keyframes) {
        if (!kf.type || !kf.visualPrompt) {
          throw new Error('关键帧缺少必需字段（type、visualPrompt）');
        }
        if (kf.type !== 'start' && kf.type !== 'end') {
          throw new Error('关键帧type必须是"start"或"end"');
        }
      }
    }
    
    console.log(`✅ 镜头拆分成功，生成 ${parsed.subShots.length} 个子镜头，耗时:`, duration, 'ms');
    
    // 记录成功日志
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `镜头拆分 - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'success',
      model: model,
      prompt: prompt.substring(0, 200) + '...',
      duration: duration
    });
    
    return parsed;
  } catch (error: any) {
    console.error('❌ 镜头拆分失败:', error);
    
    // 记录失败日志
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `镜头拆分 - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'failed',
      model: model,
      prompt: prompt.substring(0, 200) + '...',
      error: error.message,
      duration: Date.now() - startTime
    });
    
    throw new Error(`镜头拆分失败: ${error.message}`);
  }
};

/**
 * AI增强关键帧提示词 - 添加详细的技术规格和视觉细节
 * 使用LLM根据基础提示词生成专业的电影级视觉描述
 * @param basePrompt - 基础提示词(包含场景、角色、动作等基本信息)
 * @param visualStyle - 视觉风格
 * @param cameraMovement - 镜头运动
 * @param frameType - 帧类型(start/end)
 * @param model - 使用的模型,默认'gpt-5.1'
 * @returns 返回增强后的提示词
 */
export const enhanceKeyframePrompt = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  model: string = 'gpt-5.1'
): Promise<string> => {
  console.log(`🎨 enhanceKeyframePrompt 调用 - ${frameType === 'start' ? '起始帧' : '结束帧'} - 使用模型:`, model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': '真人实拍电影风格，photorealistic，8K Ultra HD',
    'anime': '日本动漫风格，cel-shaded，高饱和度色彩',
    '3d-animation': '3D CGI动画，Pixar级别渲染质量',
    'cyberpunk': '赛博朋克美学，霓虹灯光，未来科技',
    'oil-painting': '油画艺术风格，可见笔触，古典构图'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;
  const frameLabel = frameType === 'start' ? '起始帧' : '结束帧';

  const prompt = `
你是一位资深的电影摄影指导和视觉特效专家。请基于以下基础提示词,生成一个包含详细技术规格和视觉细节的专业级${frameLabel}描述。

## 基础提示词
${basePrompt}

## 视觉风格
${styleDesc}

## 镜头运动
${cameraMovement}

## ${frameLabel}要求
${frameType === 'start' ? '建立清晰的初始状态、起始姿态、为后续运动预留空间' : '展现最终状态、动作完成、情绪高潮'}

## 任务
请在基础提示词的基础上,添加以下专业的电影级视觉规格描述:

### 1. 技术规格 (Technical Specifications)
- 分辨率规格 (8K等)
- 镜头语言和摄影美学
- 景深控制和焦点策略

### 2. 视觉细节 (Visual Details)  
- 光影层次: 三点布光、阴影与高光的配置
- 色彩饱和度: 色彩分级、色温控制
- 材质质感: 表面纹理、细节丰富度
- 大气效果: 体积光、雾气、粒子、天气效果

### 3. 角色要求 (Character Details) - 如果有角色
⚠️ 最高优先级: 如果提供了角色参考图,必须严格保持人物外观的完全一致性!
- 角色识别: 严格按照参考图中人物的面部特征、发型发色、服装造型
- 面部特征: 五官轮廓、眼睛颜色形状、鼻子嘴巴结构必须与参考图一致
- 发型发色: 头发长度、颜色、质感、发型样式必须完全匹配参考图
- 服装造型: 服装款式、颜色、材质必须与参考图保持一致
- 面部表情: 在保持外观一致的基础上,添加微表情、情绪真实度、眼神方向
- 肢体语言: 在保持体型一致的基础上,展现自然的身体姿态、重心分布、肌肉张力
- 服装细节: 服装的运动感、物理真实性、纹理细节
- 毛发细节: 头发丝、自然的毛发运动

### 4. 环境要求 (Environment Details)
- 背景层次: 前景、中景、背景的深度分离
- 空间透视: 准确的线性透视、大气透视
- 环境光影: 光源的真实性、阴影投射
- 细节丰富度: 环境叙事元素、纹理变化

### 5. 氛围营造 (Mood & Atmosphere)
- 情绪基调与场景情感的匹配
- 色彩心理学的运用
- 视觉节奏的平衡
- 叙事的视觉暗示

### 6. 质量保证 (Quality Assurance)
- 主体清晰度和轮廓
- 背景过渡的自然性
- 光影一致性
- 色彩协调性
- 构图平衡(三分法或黄金比例)
- 动作连贯性

## 输出格式
请使用清晰的分节格式输出,包含上述所有要素。使用中文输出,保持专业性和可读性。

格式示例:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【技术规格】Technical Specifications
• 分辨率: ...

【视觉细节】Visual Details  
• 光影层次: ...
• 色彩饱和度: ...

(依次类推)

请开始创作:
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 3072));
    const duration = Date.now() - startTime;
    
    console.log(`✅ AI ${frameLabel}增强成功，耗时:`, duration, 'ms');
    
    // 将基础提示词和增强内容组合
    return `${basePrompt}

${result.trim()}`;
  } catch (error: any) {
    console.error(`❌ AI ${frameLabel}增强失败:`, error);
    // 如果AI增强失败,返回基础提示词
    console.warn('⚠️ 回退到基础提示词');
    return basePrompt;
  }
};


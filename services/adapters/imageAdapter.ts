import { ImageModelDefinition, ImageGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveImageModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { proxyFetch } from '../apiClient';

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403')) {
        throw error;
      }
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  
  throw lastError;
};

export const callImageApi = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) {
    throw new Error('没有可用的图片模型');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
  }
  
  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const apiModel = activeModel.apiModel || activeModel.id;
  const endpoint = '/v1/chat/completions';

  let finalPrompt = options.prompt;
  if (options.referenceImages && options.referenceImages.length > 0) {
    finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${options.prompt}".
      
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

  const requestBody: any = {
    model: apiModel,
    messages: [{ role: 'user', content: finalPrompt }],
    max_tokens: 2048,
  };

  const response = await retryOperation(async () => {
    const res = await proxyFetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      if (res.status === 400) {
        throw new Error('内容安全拦截：该提示词可能包含不安全或违规内容。请编辑关键帧/图片提示词，避免暴力、血腥、敏感描述后重试。');
      }
      if (res.status === 500) {
        throw new Error('当前请求较多，暂时未能处理成功，请稍后重试。');
      }
      
      let errorMessage = `HTTP 错误: ${res.status}`;
      try {
        const errorText = await res.text();
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          if (errorText) errorMessage = errorText;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    return await res.json();
  });

  const extractDataUrlFromContent = (text: string): string | null => {
    if (!text || typeof text !== 'string') return null;
    if (/^data:image\//i.test(text.trim())) return text.trim();
    const markdownMatch = text.match(/!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/i);
    if (markdownMatch) return markdownMatch[1];
    const anyDataMatch = text.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (anyDataMatch) return anyDataMatch[1];
    return null;
  };

  // 兼容 OpenAI choices 與 Gemini candidates 兩種圖片返回格式。
  const choices = response.choices;
  if (choices && choices.length > 0) {
    const msg = choices[0].message;
    const content = msg?.content;
    if (content) {
      if (typeof content === 'string') {
        const result = extractDataUrlFromContent(content) ?? (content.length > 100 ? `data:image/png;base64,${content}` : null);
        if (result) return result;
      }
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            return url.startsWith('data:') ? url : `data:image/png;base64,${url}`;
          }
        }
      }
    }
  }
  const candidates = response.candidates || [];
  if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  throw new Error('图片生成失败：未能从响应中提取图片数据');
};

export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: ImageModelDefinition
): boolean => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};

import { ChatModelDefinition, ChatOptions, ChatModelParams } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveChatModel } from '../modelRegistry';
import { proxyFetch } from '../apiClient';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
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

const cleanJsonResponse = (response: string): string => {
  let cleaned = response.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/```\s*$/, '');
  return cleaned.trim();
};

export const callChatApi = async (
  options: ChatOptions,
  model?: ChatModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveChatModel();
  if (!activeModel) {
    throw new Error('没有可用的对话模型');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
  }
  
  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const endpoint = activeModel.endpoint || '/v1/chat/completions';
  const apiModel = activeModel.apiModel || activeModel.id;
  
  const params: ChatModelParams = {
    ...activeModel.params,
    ...options.overrideParams,
  };
  
  const messages: any[] = [];
  
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  
  messages.push({ role: 'user', content: options.prompt });
  
  const requestBody: any = {
    model: apiModel,
    messages,
    temperature: params.temperature,
  };
  if (params.maxTokens !== undefined) {
    requestBody.max_tokens = params.maxTokens;
  }
  
  if (params.topP !== undefined) {
    requestBody.top_p = params.topP;
  }
  if (params.frequencyPenalty !== undefined) {
    requestBody.frequency_penalty = params.frequencyPenalty;
  }
  if (params.presencePenalty !== undefined) {
    requestBody.presence_penalty = params.presencePenalty;
  }
  
  if (options.responseFormat === 'json') {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const timeout = options.timeout || 600000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await retryOperation(async () => {
      const res = await proxyFetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      if (!res.ok) {
        let errorMessage = `HTTP 错误: ${res.status}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          const errorText = await res.text();
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }
      
      return res;
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    if (options.responseFormat === 'json') {
      return cleanJsonResponse(content);
    }
    
    return content;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout / 1000}秒)`);
    }
    
    throw error;
  }
};

export const verifyApiKey = async (apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string }> => {
  try {
    const url = baseUrl || 'http://api.gitcc.com';
    
    const response = await proxyFetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-41',
        messages: [{ role: 'user', content: '仅返回1' }],
        temperature: 0.1,
        max_tokens: 5,
      }),
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

import { ChatModelDefinition, ChatOptions, ChatModelParams } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveChatModel, getModelById } from '../modelRegistry';
import { proxyFetch } from '../apiClient';
import { invokeChat, makeIdempotencyKey } from '../modelGatewayClient';

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

const legacyCallChatApi = async (
  options: ChatOptions,
  activeModel: ChatModelDefinition
): Promise<string> => {
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
    if (activeModel.providerId !== 'minimax') {
      requestBody.response_format = { type: 'json_object' };
    }
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
        if (errorMessage.includes('insufficient balance') || errorMessage.includes('1008')) {
          errorMessage = 'MiniMax 账户余额不足 (1008)：请前往 MiniMax 开放平台充值或领取免费额度后重试';
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

export const callChatApi = async (
  options: ChatOptions,
  model?: ChatModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveChatModel();
  if (!activeModel) {
    throw new Error('没有可用的对话模型');
  }

  // Gateway 路由：adapter_kind === 'gateway' 走服务端网关
  if (activeModel.adapter_kind === 'gateway') {
    const result = await invokeChat(
      activeModel.id,
      { 
        prompt: options.prompt, 
        systemPrompt: options.systemPrompt, 
        responseFormat: options.responseFormat,
      },
      makeIdempotencyKey('chat'),
      { signal: (options as any).signal }
    );
    return result.content;
  }
  
  // Legacy 直连：仅开发/迁移期兜底
  console.warn('[Legacy] 使用直连适配器，建议迁移到网关模型');
  return legacyCallChatApi(options, activeModel);
};


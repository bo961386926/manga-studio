import { ModelDefinition } from '../../types/model';
import { loadRegistry } from './registryCore';
import { getProviderById } from './providers';
import { BUILTIN_PROVIDERS } from '../../types/model';

export const getGlobalApiKey = (): string | undefined => {
  return loadRegistry().globalApiKey || undefined;
};

export const setGlobalApiKey = (apiKey: string): void => {
  const state = loadRegistry();
  state.globalApiKey = apiKey;
  // saveRegistry will be called by the caller if needed
  // We don't import saveRegistry here to avoid circular deps
  // The registryCore handles persistence
};

export const getKeyMode = (): 'global' | 'mixed' => {
  return loadRegistry().keyMode || 'mixed';
};

export const setKeyMode = (mode: 'global' | 'mixed'): void => {
  const state = loadRegistry();
  state.keyMode = mode;
};

export const getApiKeyForModel = (modelId: string): string | undefined => {
  console.warn('[Deprecated] 前端不应持有 API Key，请迁移到网关模型 (adapter_kind=gateway)');
  return undefined;
};

export const getApiBaseUrlForModel = (modelId: string): string => {
  const model = getModelById(modelId);
  const provider = model ? getProviderById(model.providerId) : BUILTIN_PROVIDERS[0];
  let baseUrl = (provider?.baseUrl || BUILTIN_PROVIDERS[0].baseUrl).replace(/\/+$/, '');
  return baseUrl;
};

// Re-export getModelById to avoid circular dependency
import { getModelById } from './models';
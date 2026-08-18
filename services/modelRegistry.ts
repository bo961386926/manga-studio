// Author: forsearch | Updated: 2026-04-30
import {
  ModelType,
  ModelDefinition,
  ModelProvider,
  ModelRegistryState,
  ActiveModels,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
  BUILTIN_PROVIDERS,
  ALL_BUILTIN_MODELS,
  DEFAULT_ACTIVE_MODELS,
  AspectRatio,
  VideoDuration,
} from '../types/model';
import { getConfig, setConfig, removeConfig } from './storageService';

const STORAGE_KEY = 'manga_studio_model_registry';
const API_KEY_STORAGE_KEY = 'antsk_api_key';

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

let registryState: ModelRegistryState | null = null;

const getDefaultState = (): ModelRegistryState => ({
  providers: [...BUILTIN_PROVIDERS],
  models: [...ALL_BUILTIN_MODELS],
  activeModels: { ...DEFAULT_ACTIVE_MODELS },
  globalApiKey: undefined,
  keyMode: 'mixed',
});

/**
 * 解析并合并缓存的配置（解析 + 合并内置 + 迁移旧配置 + 清理不支持的模型）
 * 将结果写回 registryState
 */
const parseAndMergeState = (parsed: ModelRegistryState): void => {
  const deprecatedVideoModelIds = [
    'veo-3.1',
    'veo_3_1_t2v_fast_landscape',
    'veo_3_1_t2v_fast_portrait',
    'veo_3_1_i2v_s_fast_fl_landscape',
    'veo_3_1_i2v_s_fast_fl_portrait',
  ];
  
  // 合并内置提供商，并强制覆盖内置提供商的 baseUrl/name
  BUILTIN_PROVIDERS.forEach(bp => {
    const idx = parsed.providers.findIndex(p => p.id === bp.id);
    if (idx === -1) {
      parsed.providers.unshift(bp);
    } else {
      parsed.providers[idx] = { ...parsed.providers[idx], baseUrl: bp.baseUrl, name: bp.name };
    }
  });

  // 按 baseUrl 去重提供商
  const seenBaseUrls = new Set<string>();
  parsed.providers = parsed.providers.filter(p => {
    const key = normalizeBaseUrl(p.baseUrl);
    if (seenBaseUrls.has(key)) return false;
    seenBaseUrls.add(key);
    return true;
  });
  
  // 合并内置模型，确保内置模型的参数与代码保持同步
  ALL_BUILTIN_MODELS.forEach(bm => {
    const existingIndex = parsed.models.findIndex(m => m.id === bm.id);
    if (existingIndex === -1) {
      parsed.models.push(bm);
    } else {
      const existing = parsed.models[existingIndex];
      parsed.models[existingIndex] = {
        ...bm,
        isEnabled: existing.isEnabled,
        apiModel: existing.apiModel || bm.apiModel,
        apiKey: existing.apiKey || bm.apiKey,
        params: existing.params ? { ...bm.params, ...existing.params } : bm.params
      } as any;
    }
  });

  // 迁移缺失的 apiModel
  parsed.models = parsed.models.map(m => {
    if (m.apiModel) return m;
    if (m.providerId && m.id.startsWith(`${m.providerId}:`)) {
      return { ...m, apiModel: m.id.slice(m.providerId.length + 1) };
    }
    return { ...m, apiModel: m.id };
  });

  // 清理不支持的国外模型
  parsed.models = parsed.models.filter(
    m => !(m.type === 'video' && deprecatedVideoModelIds.includes(m.id))
      && !m.id.includes('gpt') && !m.id.includes('claude')
      && !m.id.includes('gemini') && !m.id.includes('sora') && !m.id.includes('veo')
  );

  // 迁移激活模型
  if (deprecatedVideoModelIds.includes(parsed.activeModels.video)
      || parsed.activeModels.video?.startsWith('veo')
      || parsed.activeModels.video?.startsWith('sora')) {
    parsed.activeModels.video = DEFAULT_ACTIVE_MODELS.video;
  }
  if (parsed.activeModels.chat?.includes('gpt') || parsed.activeModels.chat?.includes('claude')) {
    parsed.activeModels.chat = DEFAULT_ACTIVE_MODELS.chat;
  }
  const currentImageModel = parsed.models.find(m => m.id === parsed.activeModels.image);
  if (!currentImageModel
      || parsed.activeModels.image?.includes('gemini')
      || parsed.activeModels.image?.includes('wanx')
      || currentImageModel.providerId === 'aliyun') {
    parsed.activeModels.image = DEFAULT_ACTIVE_MODELS.image;
  }
  
  registryState = parsed;
  saveRegistry(parsed);
};

export const loadRegistry = (): ModelRegistryState => {
  if (registryState) {
    return registryState;
  }

  console.warn('[Registry] loadRegistry called before initRegistry - using defaults');
  registryState = getDefaultState();
  return registryState;
};

/**
 * 保存状态到 localStorage + IndexedDB（双写）
 */
export const saveRegistry = (state: ModelRegistryState): void => {
  try {
    const json = JSON.stringify(state);
    // Persist to PostgreSQL via API
    setConfig(STORAGE_KEY, json).catch(e => console.warn('[Registry] 保存失败:', e));
    // Also persist API key separately for quick access
    if (state.globalApiKey) {
      setConfig(API_KEY_STORAGE_KEY, state.globalApiKey).catch(e => console.warn('[Registry] API Key 保存失败:', e));
    }
    registryState = state;
  } catch (e) {
    console.error('保存模型注册中心失败:', e);
  }
};

/**
 * 异步初始化：从 IndexedDB 加载配置（优先），否则从 localStorage 迁移
 * 应在 App 启动时调用
 */
export const initRegistry = async (): Promise<void> => {
  if (registryState) return;

  try {
    // 1. 从 PostgreSQL 加载模型注册表
    const stored = await getConfig(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ModelRegistryState;
      parseAndMergeState(parsed);
      console.log('[Registry] 从数据库加载成功');
      
      // 2. 同步加载 API Key
      const storedApiKey = await getConfig(API_KEY_STORAGE_KEY);
      if (storedApiKey && !registryState!.globalApiKey) {
        registryState!.globalApiKey = storedApiKey;
      }
      return;
    }

    // 3. 使用默认状态
    registryState = getDefaultState();
    console.log('[Registry] 使用默认配置');
  } catch (e) {
    console.error('[Registry] 初始化失败，使用默认配置:', e);
    registryState = getDefaultState();
  }
};

/**
 * 获取当前状态
 */
export const getRegistryState = (): ModelRegistryState => {
  return loadRegistry();
};

/**
 * 重置为默认状态
 */
export const resetRegistry = (): void => {
  registryState = null;
  removeConfig(STORAGE_KEY).catch(() => {});
  removeConfig(API_KEY_STORAGE_KEY).catch(() => {});
  registryState = getDefaultState();
};

// ============================================
// 提供商管理
// ============================================

/**
 * 获取所有提供商
 */
export const getProviders = (): ModelProvider[] => {
  return loadRegistry().providers;
};

/**
 * 根据 ID 获取提供商
 */
export const getProviderById = (id: string): ModelProvider | undefined => {
  return getProviders().find(p => p.id === id);
};

/**
 * 获取默认提供商
 */
export const getDefaultProvider = (): ModelProvider => {
  return getProviders().find(p => p.isDefault) || BUILTIN_PROVIDERS[0];
};

/**
 * 添加提供商
 */
export const addProvider = (provider: Omit<ModelProvider, 'id' | 'isBuiltIn'>): ModelProvider => {
  const state = loadRegistry();
  const normalized = normalizeBaseUrl(provider.baseUrl);
  const existing = state.providers.find(p => normalizeBaseUrl(p.baseUrl) === normalized);
  if (existing) return existing;
  const newProvider: ModelProvider = {
    ...provider,
    id: `provider_${Date.now()}`,
    isBuiltIn: false,
  };
  state.providers.push(newProvider);
  saveRegistry(state);
  return newProvider;
};

/**
 * 更新提供商
 */
export const updateProvider = (id: string, updates: Partial<ModelProvider>): boolean => {
  const state = loadRegistry();
  const index = state.providers.findIndex(p => p.id === id);
  if (index === -1) return false;

  if (state.providers[index].isBuiltIn) {
    delete updates.id;
    delete updates.isBuiltIn;
    delete updates.baseUrl;
  }

  state.providers[index] = { ...state.providers[index], ...updates };
  saveRegistry(state);
  return true;
};

/**
 * 删除提供商
 */
export const removeProvider = (id: string): boolean => {
  const state = loadRegistry();
  const provider = state.providers.find(p => p.id === id);
  
  if (!provider || provider.isBuiltIn) return false;
  
  state.models = state.models.filter(m => m.providerId !== id);
  state.providers = state.providers.filter(p => p.id !== id);
  
  saveRegistry(state);
  return true;
};

// ============================================
// 模型管理
// ============================================

/**
 * 获取所有模型
 */
export const getModels = (type?: ModelType): ModelDefinition[] => {
  const models = loadRegistry().models;
  if (type) {
    return models.filter(m => m.type === type);
  }
  return models;
};

/**
 * 获取对话模型列表
 */
export const getChatModels = (): ChatModelDefinition[] => {
  return getModels('chat') as ChatModelDefinition[];
};

/**
 * 获取图片模型列表
 */
export const getImageModels = (): ImageModelDefinition[] => {
  return getModels('image') as ImageModelDefinition[];
};

/**
 * 获取视频模型列表
 */
export const getVideoModels = (): VideoModelDefinition[] => {
  return getModels('video') as VideoModelDefinition[];
};

/**
 * 根据 ID 获取模型
 */
export const getModelById = (id: string): ModelDefinition | undefined => {
  return getModels().find(m => m.id === id);
};

/**
 * 获取当前激活的模型
 */
export const getActiveModel = (type: ModelType): ModelDefinition | undefined => {
  const state = loadRegistry();
  const activeId = state.activeModels[type];
  return getModelById(activeId);
};

/**
 * 获取当前激活的对话模型
 */
export const getActiveChatModel = (): ChatModelDefinition | undefined => {
  return getActiveModel('chat') as ChatModelDefinition | undefined;
};

/**
 * 获取当前激活的图片模型
 */
export const getActiveImageModel = (): ImageModelDefinition | undefined => {
  return getActiveModel('image') as ImageModelDefinition | undefined;
};

/**
 * 获取当前激活的视频模型
 */
export const getActiveVideoModel = (): VideoModelDefinition | undefined => {
  return getActiveModel('video') as VideoModelDefinition | undefined;
};

/**
 * 设置激活的模型
 */
export const setActiveModel = (type: ModelType, modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || model.type !== type || !model.isEnabled) return false;

  const state = loadRegistry();
  state.activeModels[type] = modelId;
  saveRegistry(state);
  return true;
};

/**
 * 注册新模型
 * @param model - 模型定义（可包含自定义 id，不包含 isBuiltIn）
 */
export const registerModel = (model: Omit<ModelDefinition, 'isBuiltIn'> & { id?: string }): ModelDefinition => {
  const state = loadRegistry();
  
  const providedId = (model as any).id?.trim();
  const apiModel = (model as any).apiModel?.trim();
  const baseId = providedId || (apiModel ? `${model.providerId}:${apiModel}` : `model_${Date.now()}`);
  let modelId = baseId;

  // 若未显式提供 ID，则自动生成唯一 ID（允许 API 模型名重复）
  if (!providedId) {
    let suffix = 1;
    while (state.models.some(m => m.id === modelId)) {
      modelId = `${baseId}_${suffix++}`;
    }
  } else if (state.models.some(m => m.id === modelId)) {
    throw new Error(`模型 ID "${modelId}" 已存在，请使用其他 ID`);
  }
  
  const newModel = {
    ...model,
    id: modelId,
    apiModel: apiModel || (model.providerId && modelId.startsWith(`${model.providerId}:`)
      ? modelId.slice(model.providerId.length + 1)
      : modelId),
    isBuiltIn: false,
  } as ModelDefinition;
  
  state.models.push(newModel);
  saveRegistry(state);
  return newModel;
};

/**
 * 更新模型
 */
export const updateModel = (id: string, updates: Partial<ModelDefinition>): boolean => {
  const state = loadRegistry();
  const index = state.models.findIndex(m => m.id === id);
  if (index === -1) return false;

  // 内置模型只能修改部分字段
  if (state.models[index].isBuiltIn) {
    const allowedUpdates: Partial<ModelDefinition> = {};
    if (updates.isEnabled !== undefined) allowedUpdates.isEnabled = updates.isEnabled;
    if (updates.params) allowedUpdates.params = updates.params as any;
    if (updates.apiModel !== undefined) allowedUpdates.apiModel = updates.apiModel;
    if (updates.apiKey !== undefined) allowedUpdates.apiKey = updates.apiKey;
    state.models[index] = { ...state.models[index], ...allowedUpdates } as ModelDefinition;
  } else {
    state.models[index] = { ...state.models[index], ...updates } as ModelDefinition;
  }

  saveRegistry(state);
  return true;
};

/**
 * 删除模型
 */
export const removeModel = (id: string): boolean => {
  const state = loadRegistry();
  const model = state.models.find(m => m.id === id);
  
  // 不能删除内置模型
  if (!model || model.isBuiltIn) return false;
  
  // 如果删除的是当前激活的模型，切换到同类型的第一个启用模型
  if (state.activeModels[model.type] === id) {
    const fallback = state.models.find(m => m.type === model.type && m.id !== id && m.isEnabled);
    if (fallback) {
      state.activeModels[model.type] = fallback.id;
    }
  }
  
  state.models = state.models.filter(m => m.id !== id);
  saveRegistry(state);
  return true;
};

/**
 * 启用/禁用模型
 */
export const toggleModelEnabled = (id: string, enabled: boolean): boolean => {
  return updateModel(id, { isEnabled: enabled });
};

// ============================================
// API Key 管理
// ============================================

/**
 * 获取全局 API Key
 */
export const getGlobalApiKey = (): string | undefined => {
  return loadRegistry().globalApiKey || undefined;
};

/**
 * 设置全局 API Key
 */
export const setGlobalApiKey = (apiKey: string): void => {
  const state = loadRegistry();
  state.globalApiKey = apiKey;
  saveRegistry(state);
};

/**
 * 获取 API Key 使用模式（'global' | 'mixed'）
 */
export const getKeyMode = (): 'global' | 'mixed' => {
  return loadRegistry().keyMode || 'mixed';
};

/**
 * 设置 API Key 使用模式
 * - 'global': 所有模型统一使用全局 API Key（各服务商/模型专属 Key 不生效）
 * - 'mixed': 模型专属 Key > 提供商 Key > 其他提供商 Key > 全局 Key（兜底）
 */
export const setKeyMode = (mode: 'global' | 'mixed'): void => {
  const state = loadRegistry();
  state.keyMode = mode;
  saveRegistry(state);
};

/**
 * 获取模型对应的 API Key
 * - 全局模式：强制使用全局 API Key
 * - 混合模式：优先级 模型专属 Key > 提供商 Key > 其他提供商 Key > 全局 Key
 */
export const getApiKeyForModel = (modelId: string): string | undefined => {
  const state = loadRegistry();

  // 全局模式：所有模型统一使用同一个 Key（全局 Key 优先，未配置时取第一个有 Key 的服务商）
  if (state.keyMode === 'global') {
    if (state.globalApiKey) {
      console.log(`[ApiKey] Global mode: using global API key`);
      return state.globalApiKey;
    }
    const firstProviderKey = state.providers.find(p => p.apiKey)?.apiKey;
    if (firstProviderKey) {
      console.log(`[ApiKey] Global mode: fallback to first provider key`);
    }
    return firstProviderKey;
  }

  const model = getModelById(modelId);
  
  // 1. 优先使用模型专属 API Key
  if (model?.apiKey) {
    console.log(`[ApiKey] Found model-level key for ${modelId}`);
    return model.apiKey;
  }
  
  // 2. 其次使用对应提供商的 API Key
  if (model) {
    const provider = getProviderById(model.providerId);
    if (provider?.apiKey) {
      console.log(`[ApiKey] Found provider key for ${model.providerId}`);
      return provider.apiKey;
    }
  }
  
  // 3. 尝试所有提供商中任意一个有 Key 的（兜底）
  const allProviders = getProviders();
  const anyProviderWithKey = allProviders.find(p => p.apiKey);
  if (anyProviderWithKey?.apiKey) {
    console.log(`[ApiKey] Fallback to provider key from ${anyProviderWithKey.id}`);
    return anyProviderWithKey.apiKey;
  }
  
  // 4. 最后使用全局 API Key
  const globalKey = getGlobalApiKey();
  if (globalKey) {
    console.log(`[ApiKey] Using global API key`);
  }
  return globalKey;
};

/**
 * 获取模型对应的 API 基础 URL
 */
export const getApiBaseUrlForModel = (modelId: string): string => {
  const model = getModelById(modelId);
  const provider = model ? getProviderById(model.providerId) : BUILTIN_PROVIDERS[0];
  let baseUrl = (provider?.baseUrl || BUILTIN_PROVIDERS[0].baseUrl).replace(/\/+$/, '');

  return baseUrl;
};

// ============================================
// 辅助函数
// ============================================

/**
 * 获取激活模型的完整配置
 */
export const getActiveModelsConfig = (): ActiveModels => {
  return loadRegistry().activeModels;
};

/**
 * 检查模型是否可用（已启用且有 API Key）
 */
export const isModelAvailable = (modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || !model.isEnabled) return false;
  
  const apiKey = getApiKeyForModel(modelId);
  return !!apiKey;
};

// ============================================
// 默认值辅助函数（向后兼容）
// ============================================

/**
 * 获取默认横竖屏比例
 */
export const getDefaultAspectRatio = (): AspectRatio => {
  const imageModel = getActiveImageModel();
  if (imageModel) {
    return imageModel.params.defaultAspectRatio;
  }
  return '16:9';
};

/**
 * 获取默认视频时长
 */
export const getDefaultVideoDuration = (): VideoDuration => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.defaultDuration;
  }
  return 8;
};

/**
 * 获取视频模型类型
 */
export const getVideoModelType = (): 'sora' | 'veo' => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.mode === 'async' ? 'sora' : 'veo';
  }
  return 'sora';
};

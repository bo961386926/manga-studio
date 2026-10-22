// Core registry state management
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
} from '../../types/model';
import { getConfig, setConfig, removeConfig } from '../storageService';
import { normalizeBaseUrl } from './utils';

const STORAGE_KEY = 'manga_studio_model_registry';
const API_KEY_STORAGE_KEY = 'antsk_api_key';

let registryState: ModelRegistryState | null = null;

const getDefaultState = (): ModelRegistryState => ({
  providers: [...BUILTIN_PROVIDERS],
  models: [...ALL_BUILTIN_MODELS],
  activeModels: { ...DEFAULT_ACTIVE_MODELS },
  globalApiKey: undefined,
  keyMode: 'mixed',
});

const deprecatedVideoModelIds = [
  'veo-3.1',
  'veo_3_1_t2v_fast_landscape',
  'veo_3_1_t2v_fast_portrait',
  'veo_3_1_i2v_s_fast_fl_landscape',
  'veo_3_1_i2v_s_fast_fl_portrait',
];

/**
 * 解析并合并缓存的配置（解析 + 合并内置 + 迁移旧配置 + 清理不支持的模型）
 * 将结果写回 registryState
 */
const parseAndMergeState = (parsed: ModelRegistryState): void => {
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

  // 清理不支持的国外模型（仅按显式 ID 列表，不做关键词匹配，
  // 避免误删用户自建的 gpt/claude/gemini 等自定义模型）
  parsed.models = parsed.models.filter(
    m => !(m.type === 'video' && deprecatedVideoModelIds.includes(m.id))
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

export { getDefaultState, parseAndMergeState };
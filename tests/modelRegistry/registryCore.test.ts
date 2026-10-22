import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  loadRegistry, 
  saveRegistry, 
  initRegistry, 
  getRegistryState, 
  resetRegistry, 
  getDefaultState,
  parseAndMergeState 
} from '../../services/modelRegistry/registryCore';
import { getConfig, setConfig, removeConfig } from '../../services/storageService';
import { BUILTIN_PROVIDERS, ALL_BUILTIN_MODELS, DEFAULT_ACTIVE_MODELS } from '../../types/model';

// Mock storageService
vi.mock('../../services/storageService', () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  removeConfig: vi.fn(),
}));

describe('registryCore.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal state
    vi.mocked(removeConfig).mockResolvedValue(undefined);
    vi.mocked(setConfig).mockResolvedValue(undefined);
    vi.mocked(getConfig).mockResolvedValue(null);
  });

  it('getDefaultState 返回默认状态', () => {
    const state = getDefaultState();
    expect(state.providers).toEqual(BUILTIN_PROVIDERS);
    expect(state.models).toEqual(ALL_BUILTIN_MODELS);
    expect(state.activeModels).toEqual(DEFAULT_ACTIVE_MODELS);
    expect(state.globalApiKey).toBeUndefined();
    expect(state.keyMode).toBe('mixed');
  });

  it('loadRegistry 无状态时返回默认并警告', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = loadRegistry();
    expect(state).toEqual(getDefaultState());
    expect(consoleWarn).toHaveBeenCalledWith('[Registry] loadRegistry called before initRegistry - using defaults');
    consoleWarn.mockRestore();
  });

  it('getRegistryState 代理 loadRegistry', () => {
    const state = getRegistryState();
    expect(state).toEqual(getDefaultState());
  });

  it('saveRegistry 序列化并持久化', async () => {
    const testState = getDefaultState();
    testState.globalApiKey = 'test-key';
    await saveRegistry(testState);
    expect(setConfig).toHaveBeenCalledWith('manga_studio_model_registry', JSON.stringify(testState));
    expect(setConfig).toHaveBeenCalledWith('antsk_api_key', 'test-key');
  });

  it('resetRegistry 清除状态并重置', async () => {
    await resetRegistry();
    expect(removeConfig).toHaveBeenCalledWith('manga_studio_model_registry');
    expect(removeConfig).toHaveBeenCalledWith('antsk_api_key');
    const state = loadRegistry();
    expect(state).toEqual(getDefaultState());
  });

  describe('parseAndMergeState', () => {
    it('合并内置提供商并覆盖 baseUrl/name', () => {
      const parsed = getDefaultState();
      // 模拟存储中有修改过的内置提供商
      parsed.providers[0] = { ...parsed.providers[0], baseUrl: 'https://modified.com', name: 'Modified' };
      parseAndMergeState(parsed);
      expect(parsed.providers[0].baseUrl).toBe(BUILTIN_PROVIDERS[0].baseUrl);
      expect(parsed.providers[0].name).toBe(BUILTIN_PROVIDERS[0].name);
    });

    it('按 baseUrl 去重提供商', () => {
      const parsed = getDefaultState();
      parsed.providers.push({ 
        id: 'duplicate', 
        name: 'Duplicate', 
        baseUrl: BUILTIN_PROVIDERS[0].baseUrl, 
        isBuiltIn: false, 
        isDefault: false 
      });
      parseAndMergeState(parsed);
      const urls = parsed.providers.map(p => p.baseUrl);
      const uniqueUrls = new Set(urls);
      expect(urls.length).toBe(uniqueUrls.size);
    });

    it('合并内置模型并保留用户启用状态', () => {
      const parsed = getDefaultState();
      const builtinModel = parsed.models[0];
      builtinModel.isEnabled = false; // 用户禁用了内置模型
      parseAndMergeState(parsed);
      // 内置模型合并后应保留用户的 isEnabled
      const merged = parsed.models.find(m => m.id === builtinModel.id);
      expect(merged?.isEnabled).toBe(false);
    });

    it('迁移缺失 apiModel', () => {
      const parsed = getDefaultState();
      parsed.models[0] = { ...parsed.models[0], apiModel: undefined, providerId: 'aliyun', id: 'aliyun:qwen-max' };
      parseAndMergeState(parsed);
      expect(parsed.models[0].apiModel).toBe('qwen-max');
    });

    it('清理废弃视频模型', () => {
      const parsed = getDefaultState();
      parsed.models.push({
        id: 'veo-3.1',
        name: 'Veo 3.1',
        type: 'video',
        providerId: 'google',
        apiModel: 'veo-3.1',
        isBuiltIn: false,
        isEnabled: true,
        params: { mode: 'sync', defaultAspectRatio: '16:9', supportedAspectRatios: ['16:9'], defaultDuration: 8, supportedDurations: [8] },
      } as any);
      parseAndMergeState(parsed);
      expect(parsed.models.find(m => m.id === 'veo-3.1')).toBeUndefined();
    });

    it('迁移废弃激活视频模型到默认', () => {
      const parsed = getDefaultState();
      parsed.activeModels.video = 'veo-3.1';
      parseAndMergeState(parsed);
      expect(parsed.activeModels.video).toBe(DEFAULT_ACTIVE_MODELS.video);
    });

    it('迁移废弃激活聊天模型到默认', () => {
      const parsed = getDefaultState();
      parsed.activeModels.chat = 'gpt-4';
      parseAndMergeState(parsed);
      expect(parsed.activeModels.chat).toBe(DEFAULT_ACTIVE_MODELS.chat);
    });

    it('迁移废弃激活图片模型到默认', () => {
      const parsed = getDefaultState();
      parsed.activeModels.image = 'wanx-v1';
      parseAndMergeState(parsed);
      expect(parsed.activeModels.image).toBe(DEFAULT_ACTIVE_MODELS.image);
    });
  });

  describe('initRegistry', () => {
    it('从数据库加载成功', async () => {
      const storedState = getDefaultState();
      vi.mocked(getConfig).mockResolvedValueOnce(JSON.stringify(storedState));
      vi.mocked(getConfig).mockResolvedValueOnce(null); // api key
      await initRegistry();
      const state = loadRegistry();
      expect(state.providers).toHaveLength(storedState.providers.length);
      expect(state.models).toHaveLength(storedState.models.length);
      expect(state.activeModels).toEqual(storedState.activeModels);
    });

    it('数据库无配置时使用默认', async () => {
      vi.mocked(getConfig).mockResolvedValueOnce(null);
      await initRegistry();
      const state = loadRegistry();
      expect(state.providers).toHaveLength(getDefaultState().providers.length);
      expect(state.models).toHaveLength(getDefaultState().models.length);
      expect(state.activeModels).toEqual(getDefaultState().activeModels);
    });

    it('加载失败时使用默认', async () => {
      vi.mocked(getConfig).mockRejectedValueOnce(new Error('DB error'));
      await initRegistry();
      const state = loadRegistry();
      expect(state.providers).toHaveLength(getDefaultState().providers.length);
      expect(state.models).toHaveLength(getDefaultState().models.length);
      expect(state.activeModels).toEqual(getDefaultState().activeModels);
    });
  });
});
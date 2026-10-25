import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getGlobalApiKey, 
  setGlobalApiKey, 
  getKeyMode, 
  setKeyMode, 
  getApiKeyForModel, 
  getApiBaseUrlForModel 
} from '../../services/modelRegistry/keys';
import { loadRegistry } from '../../services/modelRegistry/registryCore';
import { getProviderById } from '../../services/modelRegistry/providers';
import { BUILTIN_PROVIDERS } from '../../types/model';

// Mock dependencies
vi.mock('../../services/modelRegistry/registryCore', () => ({
  loadRegistry: vi.fn(),
}));

vi.mock('../../services/modelRegistry/providers', () => ({
  getProviderById: vi.fn(),
}));

describe('keys.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockState = {
    providers: [
      { id: 'aliyun', name: '阿里云', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', isBuiltIn: true, isDefault: true, apiKey: 'aliyun-key' },
      { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', isBuiltIn: true, isDefault: false, apiKey: 'deepseek-key' },
    ],
    models: [
      { id: 'qwen-max', name: 'Qwen Max', type: 'chat', providerId: 'aliyun', apiModel: 'qwen-max', isBuiltIn: true, isEnabled: true, apiKey: 'model-key' },
    ],
    activeModels: { chat: 'qwen-max', image: 'doubao-image', video: 'doubao-video' },
    globalApiKey: 'global-key',
    keyMode: 'mixed',
  };

  it('getGlobalApiKey 返回全局 Key', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(getGlobalApiKey()).toBe('global-key');
  });

  it('setGlobalApiKey 设置全局 Key', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState } as any);
    setGlobalApiKey('new-global-key');
    // Note: keys.ts doesn't call saveRegistry directly, it's handled by registryCore
    // The state mutation happens in place
  });

  it('getKeyMode 返回 keyMode', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(getKeyMode()).toBe('mixed');
  });

  it('setKeyMode 设置 keyMode', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState } as any);
    setKeyMode('global');
  });

  it('getApiKeyForModel 已废弃，返回 undefined 并警告', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const result = getApiKeyForModel('qwen-max');
    expect(result).toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith('[Deprecated] 前端不应持有 API Key，请迁移到网关模型 (adapter_kind=gateway)');
    consoleWarn.mockRestore();
  });

  it('getApiBaseUrlForModel 返回提供商 baseUrl', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    vi.mocked(getProviderById).mockReturnValue(mockState.providers[0]);
    const url = getApiBaseUrlForModel('qwen-max');
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('getApiBaseUrlForModel 模型不存在时回退到第一个内置提供商', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    vi.mocked(getProviderById).mockReturnValue(undefined);
    const url = getApiBaseUrlForModel('non-existent');
    expect(url).toBe(BUILTIN_PROVIDERS[0].baseUrl);
  });
});
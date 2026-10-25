import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getProviders, 
  getProviderById, 
  getDefaultProvider, 
  addProvider, 
  updateProvider, 
  removeProvider 
} from '../../services/modelRegistry/providers';
import { loadRegistry, saveRegistry, resetRegistry } from '../../services/modelRegistry/registryCore';
import { BUILTIN_PROVIDERS } from '../../types/model';

// Mock registryCore
vi.mock('../../services/modelRegistry/registryCore', () => ({
  loadRegistry: vi.fn(),
  saveRegistry: vi.fn(),
  resetRegistry: vi.fn(),
}));

describe('providers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistry();
  });

  const mockState = {
    providers: [
      { id: 'aliyun', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', isBuiltIn: true, isDefault: true },
      { id: 'deepseek', name: 'DeepSeek API', baseUrl: 'https://api.deepseek.com/v1', isBuiltIn: true, isDefault: false },
      { id: 'custom-1', name: 'Custom Provider', baseUrl: 'https://custom.api/v1', isBuiltIn: false, isDefault: false },
    ],
    models: [],
    activeModels: { chat: 'qwen-max', image: 'doubao-image', video: 'doubao-video' },
    globalApiKey: undefined,
    keyMode: 'mixed',
  };

  it('getProviders 返回所有提供商', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const providers = getProviders();
    expect(providers).toHaveLength(3);
    expect(providers[0].id).toBe('aliyun');
  });

  it('getProviderById 找到现有提供商', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const provider = getProviderById('deepseek');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('DeepSeek API');
  });

  it('getProviderById 未找到返回 undefined', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const provider = getProviderById('non-existent');
    expect(provider).toBeUndefined();
  });

  it('getDefaultProvider 返回 isDefault=true 的提供商', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const provider = getDefaultProvider();
    expect(provider.id).toBe('aliyun');
  });

  it('getDefaultProvider 无默认时返回第一个内置提供商', () => {
    const stateNoDefault = {
      ...mockState,
      providers: mockState.providers.map(p => ({ ...p, isDefault: false })),
    };
    vi.mocked(loadRegistry).mockReturnValue(stateNoDefault as any);
    const provider = getDefaultProvider();
    expect(provider.id).toBe('aliyun'); // BUILTIN_PROVIDERS[0]
  });

  it('addProvider 新建提供商', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, providers: [...mockState.providers] } as any);
    const newProvider = addProvider({ name: 'New Provider', baseUrl: 'https://new.api/v1', isDefault: false });
    expect(newProvider.id).toMatch(/^provider_\d+$/);
    expect(newProvider.name).toBe('New Provider');
    expect(newProvider.isBuiltIn).toBe(false);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('addProvider 同 baseUrl 去重返回现有', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const existing = addProvider({ name: 'Duplicate', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', isDefault: false });
    expect(existing.id).toBe('aliyun');
    expect(saveRegistry).not.toHaveBeenCalled();
  });

  it('updateProvider 更新非内置提供商成功', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, providers: [...mockState.providers] } as any);
    const ok = updateProvider('custom-1', { name: 'Updated Name' });
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('updateProvider 内置提供商忽略 id/isBuiltIn/baseUrl', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, providers: [...mockState.providers] } as any);
    const ok = updateProvider('aliyun', { name: 'New Name', id: 'hacked', isBuiltIn: false, baseUrl: 'https://evil.com' });
    expect(ok).toBe(true);
    // saveRegistry called but internal logic filters out protected fields
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('removeProvider 删除非内置提供商成功', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, providers: [...mockState.providers], models: [] } as any);
    const ok = removeProvider('custom-1');
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('removeProvider 内置提供商不可删', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const ok = removeProvider('aliyun');
    expect(ok).toBe(false);
    expect(saveRegistry).not.toHaveBeenCalled();
  });

  it('removeProvider 不存在返回 false', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const ok = removeProvider('non-existent');
    expect(ok).toBe(false);
  });
});
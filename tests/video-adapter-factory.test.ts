import { describe, it, expect, vi } from 'vitest';
import { videoAdapterFactory } from '../services/adapters/videoAdapterFactory';
import type { VideoModelDefinition } from '../types/model';

// Mock model registry
vi.mock('../services/modelRegistry', () => ({
  getApiKeyForModel: () => 'sk-test',
  getApiBaseUrlForModel: () => 'https://api.test',
}));

describe('VideoAdapterFactory', () => {
  const createMockModel = (overrides: Partial<VideoModelDefinition> = {}): VideoModelDefinition => ({
    id: 'test-model',
    name: 'Test Model',
    type: 'video',
    providerId: 'test',
    apiModel: 'test-model',
    endpoint: '/v1/chat/completions',
    isEnabled: true,
    isBuiltIn: false,
    adapter_kind: 'legacy-vendor',
    params: {
      mode: 'async',
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16'],
      defaultDuration: 8,
      supportedDurations: [4, 8, 12],
    },
    ...overrides,
  });

  it('路由到 VeoAdapter (veo 系列模型)', () => {
    const model = createMockModel({ 
      id: 'veo-3.1', 
      apiModel: 'veo_3_1_t2v_fast_landscape',
      params: { ...createMockModel().params, mode: 'sync' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('veo');
  });

  it('路由到 SoraAdapter (sora 系列模型)', () => {
    const model = createMockModel({ 
      id: 'sora-2', 
      apiModel: 'sora',
      params: { ...createMockModel().params, mode: 'async' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('sora');
  });

  it('路由到 DoubaoAdapter (doubao/seedance 系列)', () => {
    const model = createMockModel({ 
      id: 'doubao-video', 
      apiModel: 'doubao-seedance',
      params: { ...createMockModel().params, mode: 'doubao' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('doubao');
  });

  it('路由到 MinimaxAdapter (minimax/h3 系列)', () => {
    const model = createMockModel({ 
      id: 'minimax-h3', 
      apiModel: 'MiniMax-H3',
      params: { ...createMockModel().params, mode: 'h3' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('minimax');
  });

  it('未知模型回退到 SoraAdapter (默认异步模式)', () => {
    const model = createMockModel({ 
      id: 'unknown-model', 
      apiModel: 'unknown',
      params: { ...createMockModel().params, mode: 'async' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('sora');
  });

  it('同步模式未知模型回退到 VeoAdapter', () => {
    const model = createMockModel({ 
      id: 'unknown-sync', 
      apiModel: 'unknown',
      params: { ...createMockModel().params, mode: 'sync' }
    });
    const adapter = videoAdapterFactory.createVideoAdapter(model);
    expect(adapter.name).toBe('veo');
  });

  it('支持注册自定义适配器', () => {
    const customAdapter = {
      name: 'custom',
      generate: vi.fn(),
      isAspectRatioSupported: vi.fn(),
      isDurationSupported: vi.fn(),
    };
    videoAdapterFactory.registerAdapter('custom', customAdapter as any);
    const adapters = videoAdapterFactory.getSupportedModels();
    expect(adapters).toContain('custom');
  });
});
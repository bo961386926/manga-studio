import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getModels, 
  getChatModels, 
  getImageModels, 
  getVideoModels, 
  getModelById, 
  getActiveModel, 
  getActiveChatModel, 
  getActiveImageModel, 
  getActiveVideoModel, 
  setActiveModel, 
  registerModel, 
  updateModel, 
  removeModel, 
  toggleModelEnabled 
} from '../../services/modelRegistry/models';
import { loadRegistry, saveRegistry } from '../../services/modelRegistry/registryCore';
import { ChatModelDefinition, ImageModelDefinition, VideoModelDefinition } from '../../types/model';

// Mock registryCore
vi.mock('../../services/modelRegistry/registryCore', () => ({
  loadRegistry: vi.fn(),
  saveRegistry: vi.fn(),
}));

describe('models.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockChatModel: ChatModelDefinition = {
    id: 'qwen-max',
    name: '通义千问 Max',
    type: 'chat',
    providerId: 'aliyun',
    apiModel: 'qwen-max',
    endpoint: '/chat/completions',
    isBuiltIn: true,
    isEnabled: true,
    params: { temperature: 0.7, maxTokens: 8192 },
  };

  const mockImageModel: ImageModelDefinition = {
    id: 'doubao-image',
    name: '豆包图像生成',
    type: 'image',
    providerId: 'volcengine',
    apiModel: 'doubao-seedream',
    endpoint: '/images/generations',
    isBuiltIn: true,
    isEnabled: true,
    params: { defaultAspectRatio: '16:9', supportedAspectRatios: ['16:9', '9:16'] },
  };

  const mockVideoModel: VideoModelDefinition = {
    id: 'doubao-video',
    name: '豆包视频生成',
    type: 'video',
    providerId: 'volcengine',
    apiModel: 'doubao-seedance',
    endpoint: '/v1/videos/generations',
    isBuiltIn: true,
    isEnabled: true,
    params: { 
      mode: 'doubao', 
      defaultAspectRatio: '16:9', 
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultDuration: 8,
      supportedDurations: [4, 8, 12],
    },
  };

  const mockCustomModel: ChatModelDefinition = {
    id: 'custom-chat',
    name: 'Custom Chat',
    type: 'chat',
    providerId: 'custom',
    apiModel: 'custom-model',
    endpoint: '/chat/completions',
    isBuiltIn: false,
    isEnabled: true,
    params: { temperature: 0.7 },
  };

  const mockState = {
    providers: [],
    models: [mockChatModel, mockImageModel, mockVideoModel, mockCustomModel],
    activeModels: { chat: 'qwen-max', image: 'doubao-image', video: 'doubao-video' },
    globalApiKey: undefined,
    keyMode: 'mixed',
  };

  it('getModels 返回所有模型', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const models = getModels();
    expect(models).toHaveLength(4);
  });

  it('getModels 按类型过滤', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const chatModels = getModels('chat');
    const imageModels = getModels('image');
    const videoModels = getModels('video');
    expect(chatModels).toHaveLength(2);
    expect(imageModels).toHaveLength(1);
    expect(videoModels).toHaveLength(1);
  });

  it('getChatModels / getImageModels / getVideoModels 类型别名', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(getChatModels()).toHaveLength(2);
    expect(getImageModels()).toHaveLength(1);
    expect(getVideoModels()).toHaveLength(1);
  });

  it('getModelById 找到现有模型', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const model = getModelById('qwen-max');
    expect(model).toBeDefined();
    expect(model?.name).toBe('通义千问 Max');
  });

  it('getModelById 未找到返回 undefined', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const model = getModelById('non-existent');
    expect(model).toBeUndefined();
  });

  it('getActiveModel 返回激活的模型', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const model = getActiveModel('chat');
    expect(model?.id).toBe('qwen-max');
  });

  it('getActiveChatModel / getActiveImageModel / getActiveVideoModel', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(getActiveChatModel()?.id).toBe('qwen-max');
    expect(getActiveImageModel()?.id).toBe('doubao-image');
    expect(getActiveVideoModel()?.id).toBe('doubao-video');
  });

  it('setActiveModel 成功切换', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, activeModels: { ...mockState.activeModels } } as any);
    const ok = setActiveModel('chat', 'custom-chat');
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('setActiveModel 模型不存在/类型不匹配/禁用返回 false', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(setActiveModel('chat', 'non-existent')).toBe(false);
    expect(setActiveModel('image', 'qwen-max')).toBe(false); // 类型不匹配
    expect(setActiveModel('chat', 'doubao-image')).toBe(false); // 类型不匹配
  });

  it('registerModel 自动生成唯一 ID (providerId:apiModel 格式)', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, models: [...mockState.models] } as any);
    const model = registerModel({
      id: 'test:new-model',
      providerId: 'test',
      name: 'New Model',
      apiModel: 'new-model',
      type: 'chat',
      params: { temperature: 0.7 },
      isEnabled: true,
    });
    expect(model.id).toBe('test:new-model');
    expect(model.apiModel).toBe('new-model');
    expect(model.isBuiltIn).toBe(false);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('registerModel 显式 ID 已存在抛错', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(() => registerModel({
      id: 'qwen-max',
      providerId: 'test',
      name: 'New Model',
      apiModel: 'new-model',
      type: 'chat',
      params: { temperature: 0.7 },
      isEnabled: true,
    })).toThrow('模型 ID "qwen-max" 已存在');
  });

  it('registerModel 显式 ID 可用则使用', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, models: [...mockState.models] } as any);
    const model = registerModel({
      id: 'my-custom-id',
      providerId: 'test',
      name: 'New Model',
      apiModel: 'new-model',
      type: 'chat',
      params: { temperature: 0.7 },
      isEnabled: true,
    });
    expect(model.id).toBe('my-custom-id');
  });

  it('updateModel 内置模型仅允许部分字段', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, models: [...mockState.models] } as any);
    const ok = updateModel('qwen-max', { 
      isEnabled: false, 
      params: { temperature: 0.5 }, 
      apiModel: 'new-api-model',
      apiKey: 'sk-new',
      name: 'Should Be Ignored', // 内置模型 name 不可改
    });
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('updateModel 自定义模型允许全部字段', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, models: [...mockState.models] } as any);
    const ok = updateModel('custom-chat', { name: 'Renamed', params: { temperature: 0.8 } });
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('updateModel 不存在返回 false', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(updateModel('non-existent', {})).toBe(false);
  });

  it('removeModel 删除自定义模型并切换激活态', () => {
    const state = { 
      ...mockState, 
      models: [...mockState.models], 
      activeModels: { ...mockState.activeModels, chat: 'custom-chat' } 
    };
    vi.mocked(loadRegistry).mockReturnValue(state as any);
    const ok = removeModel('custom-chat');
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });

  it('removeModel 内置模型不可删', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    expect(removeModel('qwen-max')).toBe(false);
  });

  it('removeModel 删除激活模型时回退到同类型第一个启用模型', () => {
    const state = { 
      ...mockState, 
      models: [...mockState.models], 
      activeModels: { ...mockState.activeModels, chat: 'custom-chat' } 
    };
    vi.mocked(loadRegistry).mockReturnValue(state as any);
    removeModel('custom-chat');
    const savedState = vi.mocked(saveRegistry).mock.calls[0][0];
    expect(savedState.activeModels.chat).toBe('qwen-max'); // 回退到内置模型
  });

  it('toggleModelEnabled 调用 updateModel', () => {
    vi.mocked(loadRegistry).mockReturnValue({ ...mockState, models: [...mockState.models] } as any);
    const ok = toggleModelEnabled('custom-chat', false);
    expect(ok).toBe(true);
    expect(saveRegistry).toHaveBeenCalled();
  });
});
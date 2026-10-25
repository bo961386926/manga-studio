import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getActiveModelsConfig, 
  isModelAvailable, 
  getDefaultAspectRatio, 
  getDefaultVideoDuration, 
  getVideoModelType 
} from '../../services/modelRegistry/defaults';
import { loadRegistry } from '../../services/modelRegistry/registryCore';
import { getActiveImageModel, getActiveVideoModel, getModelById } from '../../services/modelRegistry/models';

// Mock dependencies
vi.mock('../../services/modelRegistry/registryCore', () => ({
  loadRegistry: vi.fn(),
}));

vi.mock('../../services/modelRegistry/models', () => ({
  getActiveImageModel: vi.fn(),
  getActiveVideoModel: vi.fn(),
  getModelById: vi.fn(),
}));

describe('defaults.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockImageModel = {
    id: 'doubao-image',
    name: '豆包图像生成',
    type: 'image',
    providerId: 'volcengine',
    params: { defaultAspectRatio: '9:16', supportedAspectRatios: ['16:9', '9:16'] },
  };

  const mockVideoModel = {
    id: 'doubao-video',
    name: '豆包视频生成',
    type: 'video',
    providerId: 'volcengine',
    params: { mode: 'doubao', defaultDuration: 12, supportedDurations: [4, 8, 12] },
  };

  const mockState = {
    activeModels: { chat: 'qwen-max', image: 'doubao-image', video: 'doubao-video' },
  };

  it('getActiveModelsConfig 返回激活模型配置', () => {
    vi.mocked(loadRegistry).mockReturnValue(mockState as any);
    const config = getActiveModelsConfig();
    expect(config).toEqual(mockState.activeModels);
  });

  it('isModelAvailable 模型启用且存在返回 true', () => {
    const model = { id: 'test', isEnabled: true };
    vi.mocked(getModelById).mockReturnValue(model as any);
    expect(isModelAvailable('test')).toBe(true);
  });

  it('isModelAvailable 模型不存在返回 false', () => {
    vi.mocked(getModelById).mockReturnValue(undefined);
    expect(isModelAvailable('non-existent')).toBe(false);
  });

  it('isModelAvailable 模型禁用返回 false', () => {
    const model = { id: 'test', isEnabled: false };
    vi.mocked(getModelById).mockReturnValue(model as any);
    expect(isModelAvailable('test')).toBe(false);
  });

  it('getDefaultAspectRatio 返回图片模型默认比例', () => {
    vi.mocked(getActiveImageModel).mockReturnValue(mockImageModel as any);
    expect(getDefaultAspectRatio()).toBe('9:16');
  });

  it('getDefaultAspectRatio 无图片模型返回 16:9', () => {
    vi.mocked(getActiveImageModel).mockReturnValue(undefined);
    expect(getDefaultAspectRatio()).toBe('16:9');
  });

  it('getDefaultVideoDuration 返回视频模型默认时长', () => {
    vi.mocked(getActiveVideoModel).mockReturnValue(mockVideoModel as any);
    expect(getDefaultVideoDuration()).toBe(12);
  });

  it('getDefaultVideoDuration 无视频模型返回 8', () => {
    vi.mocked(getActiveVideoModel).mockReturnValue(undefined);
    expect(getDefaultVideoDuration()).toBe(8);
  });

  it('getVideoModelType async 模式返回 sora', () => {
    vi.mocked(getActiveVideoModel).mockReturnValue({ ...mockVideoModel, params: { ...mockVideoModel.params, mode: 'async' } } as any);
    expect(getVideoModelType()).toBe('sora');
  });

  it('getVideoModelType sync 模式返回 veo', () => {
    vi.mocked(getActiveVideoModel).mockReturnValue({ ...mockVideoModel, params: { ...mockVideoModel.params, mode: 'sync' } } as any);
    expect(getVideoModelType()).toBe('veo');
  });

  it('getVideoModelType 无视频模型返回 sora', () => {
    vi.mocked(getActiveVideoModel).mockReturnValue(undefined);
    expect(getVideoModelType()).toBe('sora');
  });
});
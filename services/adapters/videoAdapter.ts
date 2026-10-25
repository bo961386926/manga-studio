import { VideoModelDefinition, VideoGenerateOptions, AspectRatio, VideoDuration } from '../../types/model';
import { getActiveVideoModel } from '../modelRegistry';
import { generateVideoGatewayJob, generateVideoWithPolling } from '../modelService';
import { videoAdapterFactory } from './videoAdapterFactory';

/**
 * 统一视频生成入口
 * - 网关模型 (adapter_kind === 'gateway') -> 走服务端网关异步轮询
 * - 直连模型 -> 通过工厂分发到对应的策略适配器 (Veo/Sora/Doubao/Minimax)
 */
export const callVideoApi = async (
  options: VideoGenerateOptions,
  model?: VideoModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) {
    throw new Error('没有可用的视频模型');
  }

  // Gateway 路由：adapter_kind === 'gateway' 走服务端网关 (异步轮询)
  if (activeModel.adapter_kind === 'gateway') {
    const job = await generateVideoGatewayJob(options);
    return generateVideoWithPolling(options, { 
      intervalMs: 5000, 
      maxWaitMs: 20 * 60 * 1000 
    });
  }
  
  // Legacy 直连：通过工厂分发到策略适配器
  console.log('[VideoAdapter] 使用直连适配器 (legacy)');
  const adapter = videoAdapterFactory.createVideoAdapter(activeModel);
  return adapter.generate(options, activeModel);
};

export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: VideoModelDefinition
): boolean => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};

export const isDurationSupported = (
  duration: VideoDuration,
  model?: VideoModelDefinition
): boolean => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedDurations.includes(duration);
};

// 导出工厂供测试/扩展使用
export { videoAdapterFactory };
export type { VideoAdapter } from './videoAdapterInterface';
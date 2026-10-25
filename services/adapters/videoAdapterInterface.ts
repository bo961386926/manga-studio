import { VideoModelDefinition, VideoGenerateOptions, AspectRatio, VideoDuration } from '../../types/model';

export interface VideoAdapter {
  /** 生成视频并返回 data URL */
  generate(options: VideoGenerateOptions, model: VideoModelDefinition): Promise<string>;
  
  /** 检查模型是否支持该比例 */
  isAspectRatioSupported(aspectRatio: AspectRatio, model: VideoModelDefinition): boolean;
  
  /** 检查模型是否支持该时长 */
  isDurationSupported(duration: VideoDuration, model: VideoModelDefinition): boolean;
  
  /** 适配器标识，用于调试/日志 */
  readonly name: string;
}

export interface VideoAdapterFactory {
  createVideoAdapter(model: VideoModelDefinition): VideoAdapter;
  getSupportedModels(): string[];
}
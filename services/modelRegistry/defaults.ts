import { AspectRatio, VideoDuration } from '../../types/model';
import { getActiveImageModel, getActiveVideoModel, getModelById } from './models';
import { loadRegistry } from './registryCore';

export const getActiveModelsConfig = (): import('../../types/model').ActiveModels => {
  return loadRegistry().activeModels;
};

export const isModelAvailable = (modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || !model.isEnabled) return false;
  
  // Since getApiKeyForModel is deprecated, we just check if model is enabled
  // Actual availability is determined server-side via gateway
  return model.isEnabled;
};

export const getDefaultAspectRatio = (): AspectRatio => {
  const imageModel = getActiveImageModel();
  if (imageModel) {
    return imageModel.params.defaultAspectRatio;
  }
  return '16:9';
};

export const getDefaultVideoDuration = (): VideoDuration => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.defaultDuration;
  }
  return 8;
};

export const getVideoModelType = (): 'sora' | 'veo' => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.mode === 'async' ? 'sora' : 'veo';
  }
  return 'sora';
};
import { VideoModelDefinition, VideoGenerateOptions, AspectRatio, VideoDuration } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { throwFromVideoHttpError, formatModerationBlockedForUser } from '../videoHttpErrors';
import { resolveSoraVideoDownloadId, extractSoraDirectVideoUrl, fetchVideoUrlAsDataUrl } from '../soraVideoResolve';
import { proxyFetch } from '../apiClient';
import { VideoAdapter } from './videoAdapterInterface';

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403')) {
        throw error;
      }
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  
  throw lastError;
};

const resizeImageToSize = async (base64Data: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 canvas 上下文'));
        return;
      }
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (targetWidth - scaledWidth) / 2;
      const offsetY = (targetHeight - scaledHeight) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      const result = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      resolve(result);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = `data:image/png;base64,${base64Data}`;
  });
};

const getSizeFromAspectRatio = (aspectRatio: AspectRatio): { width: number; height: number; size: string } => {
  const sizeMap: Record<AspectRatio, { width: number; height: number; size: string }> = {
    '16:9': { width: 1280, height: 720, size: '1280x720' },
    '9:16': { width: 720, height: 1280, size: '720x1280' },
    '1:1': { width: 720, height: 720, size: '720x720' },
  };
  return sizeMap[aspectRatio];
};

export class SoraAdapter implements VideoAdapter {
  readonly name = 'sora';
  
  async generate(options: VideoGenerateOptions, model: VideoModelDefinition): Promise<string> {
    const apiKey = getApiKeyForModel(model.id);
    if (!apiKey) {
      throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
    }
    
    const apiBase = getApiBaseUrlForModel(model.id);
    const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
    const duration = options.duration || model.params.defaultDuration;
    const apiModel = model.apiModel || model.id;
    
    const { width, height, size } = getSizeFromAspectRatio(aspectRatio);

    const formData = new FormData();
    formData.append('model', apiModel);
    formData.append('prompt', options.prompt);
    formData.append('seconds', String(duration));
    formData.append('size', size);

    if (options.startImage) {
      const cleanBase64 = options.startImage.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
      const resizedBase64 = await resizeImageToSize(cleanBase64, width, height);
      
      const byteCharacters = atob(resizedBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      formData.append('input_reference', blob, 'reference.png');
    }

    const createResponse = await proxyFetch(`${apiBase}/v1/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throwFromVideoHttpError(createResponse.status, errorText, 'sora');
    }

    const createData = await createResponse.json();
    const taskId = createData.id || createData.task_id;
    
    if (!taskId) {
      throw new Error('创建视频任务失败：未返回任务 ID');
    }

    const maxPollingTime = 1200000;
    const pollingInterval = 5000;
    const startTime = Date.now();
    
    let videoId: string | null = null;
    let completedStatus: Record<string, unknown> | null = null;

    while (Date.now() - startTime < maxPollingTime) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      
      const statusResponse = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!statusResponse.ok) {
        console.warn('查询任务状态失败，继续重试...');
        continue;
      }

      const statusData = await statusResponse.json();
      const status = statusData.status;

      if (status === 'completed' || status === 'succeeded') {
        completedStatus = statusData as Record<string, unknown>;
        videoId = resolveSoraVideoDownloadId(statusData as Record<string, unknown>);
        if (!videoId && statusData.outputs?.length) {
          const o0 = statusData.outputs[0];
          videoId = typeof o0 === 'string' ? o0 : o0?.id;
        }
        if (!videoId) {
          videoId = statusData.id || null;
        }
        if (videoId && String(videoId).startsWith('task_')) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const refresh = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
              method: 'GET',
              headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
            });
            if (refresh.ok) {
              const refreshed = await refresh.json();
              const v2 = resolveSoraVideoDownloadId(refreshed as Record<string, unknown>);
              if (v2 && v2.startsWith('video_')) {
                videoId = v2;
              }
            }
          } catch (_) {
            /* ignore */
          }
        }
        break;
      } else if (status === 'failed' || status === 'error') {
        const err = statusData.error;
        const errMsg = typeof err === 'string' ? err : (err?.message || err?.code || statusData.message || '未知错误');
        if (err?.code === 'moderation_blocked') {
          throw new Error(formatModerationBlockedForUser(err, 'sora'));
        }
        throw new Error(`视频生成失败: ${errMsg}`);
      }
    }

    const directUrl = completedStatus ? extractSoraDirectVideoUrl(completedStatus) : null;
    if (directUrl) {
      try {
        return await fetchVideoUrlAsDataUrl(directUrl);
      } catch (e: any) {
        console.warn('直链下载失败，回退 /content:', e?.message);
      }
    }

    if (!videoId) {
      throw new Error('视频生成超时 (20分钟) 或未返回视频 ID');
    }

    const maxDownloadRetries = 5;
    const downloadTimeout = 600000;

    for (let attempt = 1; attempt <= maxDownloadRetries; attempt++) {
      try {
        const downloadController = new AbortController();
        const downloadTimeoutId = setTimeout(() => downloadController.abort(), downloadTimeout);
        
        const downloadResponse = await proxyFetch(`${apiBase}/v1/videos/${videoId}/content`, {
          method: 'GET',
          headers: {
            'Accept': '*/*',
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: downloadController.signal,
        });
        
        clearTimeout(downloadTimeoutId);
        
        if (!downloadResponse.ok) {
          if (
            downloadResponse.status === 502 &&
            videoId &&
            String(videoId).startsWith('task_') &&
            attempt < maxDownloadRetries
          ) {
            try {
              const refresh = await proxyFetch(`${apiBase}/v1/videos/${taskId}`, {
                method: 'GET',
                headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
              });
              if (refresh.ok) {
                const d = await refresh.json();
                const v2 = resolveSoraVideoDownloadId(d as Record<string, unknown>);
                if (v2 && v2.startsWith('video_')) {
                  videoId = v2;
                  console.warn('下载 502，已切换为 video_ 资源 ID 重试:', videoId);
                  await new Promise((r) => setTimeout(r, 3000));
                  continue;
                }
              }
            } catch (_) {
              /* fall through */
            }
          }
          if (downloadResponse.status >= 500 && attempt < maxDownloadRetries) {
            console.warn(`下载失败 HTTP ${downloadResponse.status}，${5 * attempt}秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
            continue;
          }
          throw new Error(`视频下载失败: HTTP ${downloadResponse.status}`);
        }
        
        const videoBlob = await downloadResponse.blob();
        
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            if (result && result.startsWith('data:')) {
              resolve(result);
            } else {
              reject(new Error('视频转换失败'));
            }
          };
          reader.onerror = () => reject(new Error('视频读取失败'));
          reader.readAsDataURL(videoBlob);
        });
      } catch (error: any) {
        if (attempt === maxDownloadRetries) {
          throw error;
        }
        console.warn(`下载出错: ${error.message}，重试中...`);
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }

    throw new Error('视频下载失败：已达到最大重试次数');
  }

  isAspectRatioSupported(aspectRatio: AspectRatio, model: VideoModelDefinition): boolean {
    return model.params.supportedAspectRatios.includes(aspectRatio);
  }

  isDurationSupported(duration: VideoDuration, model: VideoModelDefinition): boolean {
    return model.params.supportedDurations.includes(duration);
  }
}

export const soraAdapter = new SoraAdapter();
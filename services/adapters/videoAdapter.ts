import { VideoModelDefinition, VideoGenerateOptions, AspectRatio, VideoDuration } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveVideoModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { throwFromVideoHttpError, formatModerationBlockedForUser } from '../videoHttpErrors';
import { resolveSoraVideoDownloadId, extractSoraDirectVideoUrl, fetchVideoUrlAsDataUrl } from '../soraVideoResolve';
import { proxyFetch } from '../apiClient';

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

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: AspectRatio): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  
  if (hasReferenceImage) {
    return `veo_3_1_i2v_s_fast_fl_${orientation}`;
  } else {
    return `veo_3_1_t2v_fast_${orientation}`;
  }
};

const callVeoApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const hasStartImage = !!options.startImage;
  
  const finalAspectRatio = aspectRatio === '1:1' ? '16:9' : aspectRatio;
  
  const modelName = getVeoModelName(hasStartImage, finalAspectRatio);
  
  const cleanStart = options.startImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = options.endImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  const messages: any[] = [{ role: 'user', content: options.prompt }];

  if (cleanStart) {
    messages[0].content = [
      { type: 'text', text: options.prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${cleanStart}` } },
    ];
  }

  if (cleanEnd && Array.isArray(messages[0].content)) {
    messages[0].content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${cleanEnd}` },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200000);

  try {
    const response = await retryOperation(async () => {
      const res = await proxyFetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throwFromVideoHttpError(res.status, errorText, 'veo');
      }

      return res;
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const urlMatch = content.match(/https?:\/\/[^\s\])"]+\.mp4[^\s\])"']*/i) ||
                    content.match(/https?:\/\/[^\s\])"]+/i);
    
    if (!urlMatch) {
      throw new Error('视频生成失败：未能从响应中提取视频 URL');
    }

    const videoUrl = urlMatch[0];

    const videoResponse = await proxyFetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`视频下载失败: ${videoResponse.status}`);
    }

    const videoBlob = await videoResponse.blob();
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
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
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('视频生成超时 (20分钟)');
    }
    throw error;
  }
};

const callSoraApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
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
};

const callDoubaoSeedanceApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const endpoint = model.endpoint || '/v1/chat/completions';
  const apiModel = model.apiModel || model.id;

  // Doubao Seedance 兼容接口優先接受遠端圖片 URL。
  let messages: any[] = [];

  if (options.startImage && options.startImage.startsWith('http')) {
    messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: options.prompt },
          { type: 'image_url', image_url: { url: options.startImage } },
        ],
      },
    ];
  } else {
    messages = [{ role: 'user', content: options.prompt }];
  }

  const requestBody: any = {
    model: apiModel,
    messages,
    stream: false,
  };

  const response = await proxyFetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMessage = `Doubao Seedance 请求失败: HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error?.message || errorData.message || errorMessage;
    } catch (e) {
      const errorText = await response.text();
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  const urlMatch =
    typeof content === 'string'
      ? content.match(/https?:\/\/[^\s\])"]+\.mp4[^\s\])"']*/i) ||
        content.match(/https?:\/\/[^\s\])"]+/i)
      : JSON.stringify(content).match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i) ||
        JSON.stringify(content).match(/https?:\/\/[^\s"']+/i);

  if (!urlMatch) {
    throw new Error('Doubao Seedance 视频生成失败：未能从响应中提取视频 URL');
  }

  const videoUrl = urlMatch[0];

  const videoResponse = await proxyFetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Doubao Seedance 视频下载失败: HTTP ${videoResponse.status}`);
  }

  const videoBlob = await videoResponse.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result && result.startsWith('data:')) {
        resolve(result);
      } else {
        reject(new Error('Doubao Seedance 视频转换失败'));
      }
    };
    reader.onerror = () => reject(new Error('Doubao Seedance 视频读取失败'));
    reader.readAsDataURL(videoBlob);
  });
};

export const callVideoApi = async (
  options: VideoGenerateOptions,
  model?: VideoModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) {
    throw new Error('没有可用的视频模型');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
  }

  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const mode = activeModel.params.mode;

  const isDoubaoSeedance =
    mode === 'doubao' ||
    (activeModel.endpoint && activeModel.endpoint.includes('/api/v3/contents/generations/tasks')) ||
    (activeModel.apiModel && activeModel.apiModel.startsWith('doubao-seedance'));

  if (isDoubaoSeedance) {
    return callDoubaoSeedanceApi(options, activeModel, apiKey, apiBase);
  }

  if (mode === 'async') {
    return callSoraApi(options, activeModel, apiKey, apiBase);
  } else {
    return callVeoApi(options, activeModel, apiKey, apiBase);
  }
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

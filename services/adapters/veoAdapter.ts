import { VideoModelDefinition, VideoGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { throwFromVideoHttpError } from '../videoHttpErrors';
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

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: AspectRatio): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  
  if (hasReferenceImage) {
    return `veo_3_1_i2v_s_fast_fl_${orientation}`;
  } else {
    return `veo_3_1_t2v_fast_${orientation}`;
  }
};

export class VeoAdapter implements VideoAdapter {
  readonly name = 'veo';
  
  async generate(options: VideoGenerateOptions, model: VideoModelDefinition): Promise<string> {
    const apiKey = getApiKeyForModel(model.id);
    if (!apiKey) {
      throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
    }
    
    const apiBase = getApiBaseUrlForModel(model.id);
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
  }

  isAspectRatioSupported(aspectRatio: AspectRatio, model: VideoModelDefinition): boolean {
    return model.params.supportedAspectRatios.includes(aspectRatio);
  }

  isDurationSupported(duration: number, model: VideoModelDefinition): boolean {
    return model.params.supportedDurations.includes(duration as any);
  }
}

export const veoAdapter = new VeoAdapter();
import { VideoModelDefinition, VideoGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { proxyFetch } from '../apiClient';
import { VideoAdapter } from './videoAdapterInterface';

export class DoubaoAdapter implements VideoAdapter {
  readonly name = 'doubao';
  
  async generate(options: VideoGenerateOptions, model: VideoModelDefinition): Promise<string> {
    const apiKey = getApiKeyForModel(model.id);
    if (!apiKey) {
      throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
    }
    
    const apiBase = getApiBaseUrlForModel(model.id);
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
  }

  isAspectRatioSupported(aspectRatio: AspectRatio, model: VideoModelDefinition): boolean {
    return model.params.supportedAspectRatios.includes(aspectRatio);
  }

  isDurationSupported(duration: number, model: VideoModelDefinition): boolean {
    return model.params.supportedDurations.includes(duration as any);
  }
}

export const doubaoAdapter = new DoubaoAdapter();
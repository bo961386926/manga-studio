/**
 * All AI API requests go through the local backend to avoid CORS and proxy issues,
 * and to allow backend logging of target URLs, payloads, and errors.
 */

import { apiFetch } from './storageService';
import type { MediaRef } from '../types/modelGateway';

// Upload a Data URL into a private MediaRef via the authenticated gateway.
// Credentials are never accepted from the browser; only the server holds keys.
export const uploadMediaAsRef = async (dataUrl: string): Promise<MediaRef> => {
  const res = await apiFetch('/model-invocations/media-assets', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
  return {
    kind: 'media',
    id: res.assetId,
    contentType: res.contentType,
    sizeBytes: Number(res.sizeBytes),
  };
};

// Helper to convert Blob to base64 string in browser
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Extract base64 part
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * DEPRECATED — legacy vendor adapters only.
 *
 * The server-side /api/ai-forward route has been REMOVED (stage-3 gate):
 * production code no longer accepts arbitrary target URLs, upstream headers
 * or client credentials. This function now always fails; legacy vendor calls
 * must migrate to gateway-managed models (services/modelGatewayClient).
 * Gateway models never use this path.
 *
 * 这条错误会一路冒泡到界面上用户看到的那行红字（StageScript/StageAssets/
 * StageDirector 的 catch 都直接展示 err.message），所以必须是**可执行的指引**：
 * 告诉用户去哪里配置，而不是甩出 "legacy forward proxy removed" 这种内部黑话。
 */
export const proxyFetch = async (targetUrl: string, _options?: RequestInit): Promise<Response> => {
  const detail = `legacy forward proxy removed: ${targetUrl} must migrate to the self-hosted gateway`;
  console.warn(`[apiClient] ${detail}`);
  throw new Error(
    '当前模型未接入服务端网关，无法调用。请到「模型配置 → 网关」添加服务商与模型后重试；' +
      '若账号没有配置权限，请联系管理员完成模型配置（或运行迁移向导导入本地配置）。'
  );
};

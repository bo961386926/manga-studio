/**
 * All AI API requests go through the local backend to avoid CORS and proxy issues,
 * and to allow backend logging of target URLs, payloads, and errors.
 */

import { apiFetch } from './storageService';
import type { MediaRef } from '../types/modelGateway';

// Upload a Data URL into a private MediaRef via the authenticated gateway.
// Credentials are never accepted from the browser; only the server holds keys.
export const uploadMediaAsRef = async (dataUrl: string): Promise<MediaRef> => {
  const res = await apiFetch('/media-assets', {
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
 * or client credentials. This function now always fails with a clear message;
 * legacy vendor calls must migrate to gateway-managed models
 * (services/modelGatewayClient). Gateway models never use this path.
 */
export const proxyFetch = async (_targetUrl: string, _options?: RequestInit): Promise<Response> => {
  throw new Error('legacy forward proxy removed: migrate this model to the self-hosted gateway');
};

/**
 * All AI API requests go through the local backend to avoid CORS and proxy issues,
 * and to allow backend logging of target URLs, payloads, and errors.
 */

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

export const proxyFetch = async (targetUrl: string, options?: RequestInit): Promise<Response> => {
  const backendUrl = '/api/ai-forward';
  
  let cleanUrl = targetUrl;
  if (cleanUrl.startsWith('/api-vc')) cleanUrl = cleanUrl.replace('/api-vc', 'https://ark.cn-beijing.volces.com');
  if (cleanUrl.startsWith('/api-ds')) cleanUrl = cleanUrl.replace('/api-ds', 'https://dashscope.aliyuncs.com/api/v1');
  if (cleanUrl.startsWith('/api-dp')) cleanUrl = cleanUrl.replace('/api-dp', 'https://api.deepseek.com');
  
  if (!cleanUrl.startsWith('http')) {
    console.warn(`[proxyFetch] targetUrl is not absolute: ${cleanUrl}`);
  }

  let bodyPayload: any = undefined;

  if (options?.body) {
    if (options.body instanceof FormData) {
      const fields: Record<string, string> = {};
      const files: Record<string, { name: string; type: string; data: string }> = {};

      for (const [key, value] of options.body.entries()) {
        if (value instanceof Blob) {
          const base64Data = await blobToBase64(value);
          files[key] = {
            name: (value as any).name || 'file',
            type: value.type,
            data: base64Data
          };
        } else {
          fields[key] = String(value);
        }
      }

      bodyPayload = {
        isFormData: true,
        fields,
        files
      };
    } else if (typeof options.body === 'string') {
      try {
        bodyPayload = JSON.parse(options.body);
      } catch {
        bodyPayload = options.body;
      }
    } else {
      bodyPayload = options.body;
    }
  }

  const payload = {
    targetUrl: cleanUrl,
    method: options?.method || 'GET',
    headers: options?.headers,
    body: bodyPayload
  };

  return fetch(backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

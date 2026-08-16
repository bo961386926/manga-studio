import { proxyFetch } from './apiClient';

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function firstVideoPrefixed(candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c && c.startsWith('video_')) return c;
  }
  return null;
}

export function resolveSoraVideoDownloadId(statusData: Record<string, unknown>): string | null {
  const outputs = statusData.outputs;
  const outIds: string[] = [];
  if (Array.isArray(outputs)) {
    for (const item of outputs) {
      const s = asString(item);
      if (s) outIds.push(s);
      else if (item && typeof item === 'object' && item !== null) {
        const id = asString((item as Record<string, unknown>).id);
        if (id) outIds.push(id);
      }
    }
  }

  const videoObj = statusData.video;
  const videoNestedId =
    videoObj && typeof videoObj === 'object' && videoObj !== null
      ? asString((videoObj as Record<string, unknown>).id)
      : null;

  const result = statusData.result;
  let resultId: string | null = null;
  if (result && typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    resultId = asString(r.video_id) || asString(r.id) || asString(r.file_id);
  }

  const preferred = firstVideoPrefixed([
    videoNestedId,
    asString(statusData.id),
    asString(statusData.video_id),
    asString(statusData.output_video),
    ...outIds,
    resultId,
  ]);

  if (preferred) return preferred;

  const fallback =
    asString(statusData.video_id) ||
    asString(statusData.output_video) ||
    outIds[0] ||
    resultId ||
    asString(statusData.id);

  return fallback;
}

// 部分网关 completed 时会直接给出可播放直链，可避开 /content 代理 502。
export function extractSoraDirectVideoUrl(statusData: Record<string, unknown>): string | null {
  for (const key of ['result_url', 'video_url', 'download_url'] as const) {
    const v = asString(statusData[key]);
    if (v && /^https?:\/\//i.test(v)) return v.trim();
  }
  const u = asString(statusData.url);
  if (u && /^https?:\/\//i.test(u) && (/\.mp4(\?|$)/i.test(u) || /\/videos?\//i.test(u))) {
    return u.trim();
  }
  return null;
}

export async function fetchVideoUrlAsDataUrl(url: string): Promise<string> {
  const response = await proxyFetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const r = reader.result as string;
      if (r && r.startsWith('data:')) resolve(r);
      else reject(new Error('视频转 base64 失败'));
    };
    reader.onerror = () => reject(new Error('读取视频失败'));
    reader.readAsDataURL(blob);
  });
}

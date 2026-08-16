/**
 * 将 base64 格式的视频 data URL 转换为本地 Blob URL。
 * 解决浏览器（如 Safari/Chrome）对大体积 base64 视频直接播放、拖动进度条挂起或无法播放（0:00/0:00）的兼容性问题。
 */
export const base64ToBlobUrl = (base64DataUrl: string): string => {
  try {
    if (!base64DataUrl || !base64DataUrl.startsWith('data:')) {
      return base64DataUrl;
    }
    const parts = base64DataUrl.split(';base64,');
    if (parts.length < 2) return base64DataUrl;
    
    const contentType = parts[0].split(':')[1] || 'video/mp4';
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    const blob = new Blob([uInt8Array], { type: contentType });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('[Video Utils] Failed to convert base64 to Blob URL:', e);
    return base64DataUrl;
  }
};

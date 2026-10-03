// 字幕 PNG 渲染（浏览器 canvas）。
//
// 为什么不用 ffmpeg 的 subtitles/drawtext 滤镜：ffmpeg.wasm 的 core 虽然编译了
// libass/freetype，但 wasm 环境里没有任何 CJK 字体文件，烧中文字幕会渲染成方框。
// 改用 overlay 叠加：每条字幕用 canvas 画成透明底 PNG（走浏览器自带中文字体，
// 样式与网页一致、天然支持多行），再按时间窗 enable 叠加到画面上。
import type { SubtitleCue } from './subtitleService';

const BASE_WIDTH = 1280; // 渲染基准宽度，实际视频宽度不同时按比例缩放
const BASE_FONT_PX = 42;
const LINE_HEIGHT = 1.4;
const PADDING_X = 30;
const PADDING_Y = 16;
const RADIUS = 14;

/** 探测第一个视频片段的真实宽度，让字幕大小与成片分辨率匹配（失败回退 1280） */
export const probeVideoWidth = (url: string): Promise<number> =>
  new Promise(resolve => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => resolve(video.videoWidth || BASE_WIDTH);
      video.onerror = () => resolve(BASE_WIDTH);
      video.src = url;
    } catch (_) {
      resolve(BASE_WIDTH);
    }
  });

export const renderCuePng = async (cue: SubtitleCue, videoWidth = BASE_WIDTH): Promise<Uint8Array> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建字幕画布');

  const scale = Math.max(0.5, Math.min(3, videoWidth / BASE_WIDTH));
  const fontPx = Math.round(BASE_FONT_PX * scale);
  const padX = Math.round(PADDING_X * scale);
  const padY = Math.round(PADDING_Y * scale);
  const radius = Math.round(RADIUS * scale);
  const font = `bold ${fontPx}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`;

  const lines = cue.text.split('\n');
  const lineHeight = fontPx * LINE_HEIGHT;

  ctx.font = font;
  const textWidth = Math.max(...lines.map(l => ctx.measureText(l).width));

  canvas.width = Math.ceil(textWidth + padX * 2);
  canvas.height = Math.ceil(lines.length * lineHeight + padY * 2);

  // 重设画布尺寸会重置 2D 状态，字体需要重新指定
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 半透明黑底圆角胶囊，保证任意画面上可读
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, padY + lineHeight * (i + 0.5));
  });

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('字幕 PNG 生成失败');
  return new Uint8Array(await blob.arrayBuffer());
};

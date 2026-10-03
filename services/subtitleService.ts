// 字幕服务：把分镜台词变成字幕时间轴（cue），并输出标准 SRT 文本。
//
// 时间轴只累计「已完成视频」的镜头，与导出合并（mergeShotsToSingleMp4）的
// 片段集合与顺序完全一致——未渲染的镜头既不产生字幕也不占时间。
// 纯函数模块：时间轴、SRT 格式化都不依赖 DOM，全部可单测。
import type { Shot } from '../types';

export interface SubtitleCue {
  /** 从 1 开始的序号（SRT 规范） */
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface BuildSubtitleOptions {
  /** 无台词镜头用动作描述作为字幕（缺省 false：只出台词） */
  useActionSummary?: boolean;
}

const shotText = (shot: Shot, useActionSummary: boolean): string => {
  const raw = useActionSummary ? shot.actionSummary : shot.dialogue;
  return (raw || '').trim();
};

export const buildSubtitleCues = (shots: Shot[], options: BuildSubtitleOptions = {}): SubtitleCue[] => {
  const useActionSummary = options.useActionSummary === true;
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (const shot of shots) {
    const duration = shot.interval?.duration;
    const hasVideo = Boolean(shot.interval?.videoUrl) && typeof duration === 'number' && duration > 0;
    if (!hasVideo) continue;
    const start = cursor;
    const end = cursor + (duration as number);
    cursor = end;
    const text = shotText(shot, useActionSummary);
    if (!text) continue;
    cues.push({ index: cues.length + 1, startSeconds: start, endSeconds: end, text });
  }
  return cues;
};

/** SRT 时间戳：HH:MM:SS,mmm（逗号是规范要求，毫秒四舍五入可进位） */
export const formatSrtTimestamp = (seconds: number): string => {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

export const cuesToSrt = (cues: SubtitleCue[]): string => {
  if (cues.length === 0) return '';
  return (
    cues
      .map(
        c =>
          `${c.index}\n${formatSrtTimestamp(c.startSeconds)} --> ${formatSrtTimestamp(c.endSeconds)}\n${c.text}`
      )
      .join('\n\n') + '\n'
  );
};

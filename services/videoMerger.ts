// 使用 ffmpeg.wasm 在浏览器端把多个视频片段合并为单个 MP4
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { Shot } from '../types';
import type { SubtitleCue } from './subtitleService';
import { probeVideoWidth, renderCuePng } from './subtitleCanvas';

let ffmpegInstance: FFmpeg | null = null;
// 模块级进度回调，避免重复注册 listener 导致回调累积
let progressHandler: ((progress: number) => void) | null = null;

const CORE_BASE = '/ffmpeg';

async function loadFfmpeg(onProgress?: (phase: string, progress: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    if (progressHandler && progress > 0) progressHandler(progress);
  });
  onProgress?.('正在加载 ffmpeg 核心（首次约 30MB）...', 2);
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

// ---------- 字幕烧录（overlay 方案） ----------
// ffmpeg.wasm core 没有 CJK 字体，libass/drawtext 烧中文会变方框，
// 因此字幕先用 canvas 渲染成透明底 PNG（services/subtitleCanvas.ts），
// 这里按时间窗 enable 叠加到画面上。纯函数部分可单测。

export interface SubtitleOverlay {
  file: string;
  startSeconds: number;
  endSeconds: number;
}

// between(t,…) 里的秒数：最多 3 位小数并去掉尾零（0 → '0'，3.5 → '3.5'）
const fmtEnableSeconds = (n: number): string => String(Math.round(n * 1000) / 1000);

/** 字幕叠加计划：每条 cue 一个 PNG 文件与时间窗 */
export const buildSubtitleOverlayPlan = (cues: SubtitleCue[]): SubtitleOverlay[] =>
  cues.map((c, i) => ({
    file: `sub_${String(i + 1).padStart(3, '0')}.png`,
    startSeconds: c.startSeconds,
    endSeconds: c.endSeconds,
  }));

/** 烧录字幕的 ffmpeg 参数：concat + 逐条 overlay(enable 时间窗) + 重编码 */
export const buildSubtitleMergeArgs = (options: {
  listFile: string;
  outputName: string;
  overlays: SubtitleOverlay[];
  audioMix?: AudioMixPlan;
}): string[] => {
  const { listFile, outputName, overlays, audioMix } = options;
  if (overlays.length === 0) {
    throw new Error('字幕叠加计划为空');
  }
  const inputs = overlays.flatMap(o => ['-i', o.file]);
  const chain = overlays
    .map((o, i) => {
      const main = i === 0 ? '[0:v]' : `[v${i - 1}]`;
      const out = i === overlays.length - 1 ? '[vout]' : `[v${i}]`;
      const enable = `enable='between(t,${fmtEnableSeconds(o.startSeconds)},${fmtEnableSeconds(o.endSeconds)})'`;
      return `${main}[${i + 1}:v]overlay=(W-w)/2:H-h-48:${enable}${out}`;
    })
    .join(';');
  // 音频输入紧跟字幕 PNG 输入之后（concat 主输入 0，PNG 从 1 起），
  // 因此混音计划的标签索引整体偏移 overlays.length + 1。
  const shifted: AudioMixPlan | undefined = audioMix
    ? {
        inputs: audioMix.inputs,
        outLabel: audioMix.outLabel,
        filter: audioMix.filter.replace(/\[(\d+):a\]/g, (_, n) => `[${Number(n) + overlays.length + 1}:a]`),
      }
    : undefined;
  return [
    '-f', 'concat', '-safe', '0',
    '-i', listFile,
    ...inputs,
    ...(shifted ? audioMix!.inputs : []),
    '-filter_complex', shifted ? `${chain};${shifted.filter}` : chain,
    '-map', '[vout]',
    ...(shifted ? ['-map', `[${shifted.outLabel}]`] : []),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac',
    outputName,
  ];
};

export interface MergeOptions {
  /** 需要烧录的字幕（非空时走 overlay 合成路径） */
  subtitleCues?: SubtitleCue[];
  /** 测试/特殊场景可注入的自定义渲染器；缺省用 canvas 渲染 */
  renderCuePng?: (cue: SubtitleCue) => Promise<Uint8Array>;
  /** 旁白音频文件路径（按镜头顺序，将 concat 为一条音轨） */
  narrationPaths?: string[];
  /** BGM 音频文件路径（循环垫底） */
  bgmPath?: string;
  /** BGM 音量（默认 0.25） */
  bgmVolume?: number;
  /** 旁白音频二进制（mp3，按镜头顺序；执行层写入虚拟 FS） */
  narrationData?: Uint8Array[];
  /** BGM 音频二进制（mp3，执行层写入虚拟 FS） */
  bgmData?: Uint8Array;
}

/**
 * 把已渲染的视频片段合并为单个 MP4 并下载；可选烧录字幕
 */
export async function mergeShotsToSingleMp4(
  shots: Shot[],
  outputName: string,
  onProgress?: (phase: string, progress: number) => void,
  options?: MergeOptions
): Promise<void> {
  const completed = shots.filter(s => s.interval?.videoUrl);
  if (completed.length === 0) {
    throw new Error('没有可合并的视频片段');
  }
  const subtitleCues = options?.subtitleCues ?? [];
  const burnSubtitles = subtitleCues.length > 0;
  const pngFiles: string[] = [];

  const ffmpeg = await loadFfmpeg(onProgress);

  // 1. 把每个片段写入 ffmpeg 虚拟文件系统
  onProgress?.('正在准备视频片段...', 8);
  const files: string[] = [];
  for (let i = 0; i < completed.length; i++) {
    const shot = completed[i];
    const name = `shot_${String(i + 1).padStart(3, '0')}.mp4`;
    const data = await fetchFile(shot.interval!.videoUrl!);
    await ffmpeg.writeFile(name, data);
    files.push(name);
    onProgress?.(
      `准备片段 ${i + 1}/${completed.length}...`,
      8 + Math.round(((i + 1) / completed.length) * 12)
    );
  }

  // 2. concat 列表
  const listContent = files.map(f => `file '${f}'`).join('\n');
  await ffmpeg.writeFile('concat_list.txt', new TextEncoder().encode(listContent));

  // 2b. ② 音频：旁白/BGM 写入虚拟 FS，构建混音计划
  const narrationPaths: string[] = [];
  for (let i = 0; i < (options?.narrationData?.length ?? 0); i++) {
    const name = `narr_${String(i + 1).padStart(3, '0')}.mp3`;
    await ffmpeg.writeFile(name, options!.narrationData![i]);
    narrationPaths.push(name);
  }
  let bgmPath: string | undefined;
  if (options?.bgmData) {
    await ffmpeg.writeFile('bgm_track.mp3', options.bgmData);
    bgmPath = 'bgm_track.mp3';
  }
  const audioMix = buildAudioMixPlan({ narrationPaths, bgmPath, bgmVolume: options?.bgmVolume });

  if (burnSubtitles) {
    // 3a. 烧录字幕路径：滤镜必须重编码，先渲染字幕 PNG，再 overlay 合成
    onProgress?.('正在渲染字幕图片...', 18);
    const overlays = buildSubtitleOverlayPlan(subtitleCues);
    let draw = options?.renderCuePng;
    if (!draw) {
      const videoWidth = await probeVideoWidth(completed[0].interval!.videoUrl!);
      draw = (cue) => renderCuePng(cue, videoWidth);
    }
    for (let i = 0; i < overlays.length; i++) {
      const png = await draw(subtitleCues[i]);
      await ffmpeg.writeFile(overlays[i].file, png);
      pngFiles.push(overlays[i].file);
      onProgress?.(
        `正在渲染字幕 ${i + 1}/${overlays.length}...`,
        18 + Math.round(((i + 1) / overlays.length) * 4)
      );
    }

    progressHandler = (p) => {
      onProgress?.('正在烧录字幕并编码（较慢）...', Math.min(82, 22 + Math.round(p * 60)));
    };
    onProgress?.('正在烧录字幕并编码（较慢）...', 22);
    const args = buildSubtitleMergeArgs({
      listFile: 'concat_list.txt',
      outputName: 'output.mp4',
      overlays,
      audioMix,
    });
    const exitCode = await ffmpeg.exec(args);
    progressHandler = null;
    if (exitCode !== 0) {
      throw new Error('字幕合成失败（ffmpeg 返回非零退出码）');
    }
  } else {
    // 3b. 无字幕：先尝试 stream copy（快），失败/为空则重编码（慢但兼容不同来源）
    let merged = false;
    progressHandler = (p) => {
      onProgress?.('正在合并视频...', Math.min(82, 20 + Math.round(p * 62)));
    };

    try {
      if (!audioMix) {
        onProgress?.('正在合并（快速模式）...', 22);
        const exitCode = await ffmpeg.exec([
          '-f', 'concat', '-safe', '0',
          '-i', 'concat_list.txt',
          '-c', 'copy',
          'output.mp4'
        ]);
        if (exitCode === 0) {
          const out = await ffmpeg.readFile('output.mp4') as Uint8Array;
          if (out.length > 0) merged = true;
        }
      }
    } catch (e) {
      console.warn('[videoMerger] 快速合并失败，将重编码:', e);
    }

    if (!merged) {
      onProgress?.(audioMix ? '正在混音并重编码（较慢）...' : '片段编码不一致，正在重新编码（较慢）...', 20);
      progressHandler = (p) => {
        onProgress?.(audioMix ? '正在混音并重编码...' : '正在重新编码...', Math.min(82, 20 + Math.round(p * 62)));
      };
      await ffmpeg.exec([
        '-f', 'concat', '-safe', '0',
        '-i', 'concat_list.txt',
        ...(audioMix ? audioMix.inputs : []),
        ...(audioMix ? ['-filter_complex', audioMix.filter, '-map', '0:v', '-map', `[${audioMix.outLabel}]`] : []),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac',
        'output.mp4'
      ]);
    }

    progressHandler = null;
  }

  // 4. 读取并下载
  onProgress?.('正在生成文件...', 90);
  const data = await ffmpeg.readFile('output.mp4') as Uint8Array;
  const blob = new Blob([data], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${outputName || 'master'}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // 5. 清理虚拟文件系统
  for (const f of files) {
    try { await ffmpeg.deleteFile(f); } catch (_) { /* ignore */ }
  }
  for (const f of pngFiles) {
    try { await ffmpeg.deleteFile(f); } catch (_) { /* ignore */ }
  }
  try { await ffmpeg.deleteFile('concat_list.txt'); } catch (_) { /* ignore */ }
  try { await ffmpeg.deleteFile('output.mp4'); } catch (_) { /* ignore */ }

  onProgress?.('完成！', 100);
}

// ===== ② 音频混音：旁白串联 + BGM 循环垫底（amix，duration=first 以旁白为准）=====
export interface AudioMixPlan { inputs: string[]; filter: string; outLabel: string; }
export const buildAudioMixPlan = (
  { narrationPaths, bgmPath, bgmVolume = 0.25 }: { narrationPaths: string[]; bgmPath?: string; bgmVolume?: number }
): AudioMixPlan | null => {
  const hasNarration = narrationPaths.length > 0;
  if (!hasNarration && !bgmPath) return null;
  const inputs: string[] = [];
  for (const p of narrationPaths) inputs.push('-i', p);
  let bgmIndex = -1;
  if (bgmPath) {
    bgmIndex = narrationPaths.length;
    inputs.push('-stream_loop', '-1', '-i', bgmPath);
  }
  const parts: string[] = [];
  if (hasNarration) {
    const narrIn = narrationPaths.map((_, i) => `[${i}:a]`).join('');
    parts.push(`${narrIn}concat=n=${narrationPaths.length}:v=0:a=1[narr]`);
  }
  if (bgmIndex >= 0) parts.push(`[${bgmIndex}:a]volume=${bgmVolume}[bgm]`);
  if (hasNarration && bgmIndex >= 0) {
    parts.push(`[narr][bgm]amix=inputs=2:duration=first[aout]`);
  } else if (hasNarration) {
    parts.push(`[narr]anull[aout]`);
  } else {
    parts.push(`[bgm]anull[aout]`);
  }
  return { inputs, filter: parts.join(';'), outLabel: 'aout' };
};

// 使用 ffmpeg.wasm 在浏览器端把多个视频片段合并为单个 MP4
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { Shot } from '../types';

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

/**
 * 把已渲染的视频片段合并为单个 MP4 并下载
 */
export async function mergeShotsToSingleMp4(
  shots: Shot[],
  outputName: string,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  const completed = shots.filter(s => s.interval?.videoUrl);
  if (completed.length === 0) {
    throw new Error('没有可合并的视频片段');
  }

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

  // 3. 先尝试 stream copy（快），失败/为空则重编码（慢但兼容不同来源）
  let merged = false;
  progressHandler = (p) => {
    onProgress?.('正在合并视频...', Math.min(82, 20 + Math.round(p * 62)));
  };

  try {
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
  } catch (e) {
    console.warn('[videoMerger] 快速合并失败，将重编码:', e);
  }

  if (!merged) {
    onProgress?.('片段编码不一致，正在重新编码（较慢）...', 20);
    progressHandler = (p) => {
      onProgress?.('正在重新编码...', Math.min(82, 20 + Math.round(p * 62)));
    };
    await ffmpeg.exec([
      '-f', 'concat', '-safe', '0',
      '-i', 'concat_list.txt',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac',
      'output.mp4'
    ]);
  }

  progressHandler = null;

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
  try { await ffmpeg.deleteFile('concat_list.txt'); } catch (_) { /* ignore */ }
  try { await ffmpeg.deleteFile('output.mp4'); } catch (_) { /* ignore */ }

  onProgress?.('完成！', 100);
}

import { describe, it, expect } from 'vitest';
import { buildSubtitleOverlayPlan, buildSubtitleMergeArgs } from '../services/videoMerger';
import type { SubtitleCue } from '../services/subtitleService';

const cues: SubtitleCue[] = [
  { index: 1, startSeconds: 0, endSeconds: 3, text: '你好' },
  { index: 2, startSeconds: 3, endSeconds: 5.5, text: '世界' },
];

describe('buildSubtitleOverlayPlan（字幕叠加计划）', () => {
  it('按顺序给每条字幕分配 PNG 文件名并保留时间窗', () => {
    const plan = buildSubtitleOverlayPlan(cues);
    expect(plan).toEqual([
      { file: 'sub_001.png', startSeconds: 0, endSeconds: 3 },
      { file: 'sub_002.png', startSeconds: 3, endSeconds: 5.5 },
    ]);
  });

  it('空字幕返回空计划', () => {
    expect(buildSubtitleOverlayPlan([])).toEqual([]);
  });
});

describe('buildSubtitleMergeArgs（ffmpeg 参数链）', () => {
  it('单条字幕：overlay 居中偏下 + enable 时间窗 + 重编码参数', () => {
    const args = buildSubtitleMergeArgs({
      listFile: 'concat_list.txt',
      outputName: 'out.mp4',
      overlays: [{ file: 'sub_001.png', startSeconds: 0, endSeconds: 3 }],
    });
    expect(args).toEqual([
      '-f', 'concat', '-safe', '0',
      '-i', 'concat_list.txt',
      '-i', 'sub_001.png',
      '-filter_complex',
      "[0:v][1:v]overlay=(W-w)/2:H-h-48:enable='between(t,0,3)'[vout]",
      '-map', '[vout]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac',
      'out.mp4',
    ]);
  });

  it('多条字幕：filter_complex 链式叠加，最终标签 vout', () => {
    const args = buildSubtitleMergeArgs({
      listFile: 'concat_list.txt',
      outputName: 'out.mp4',
      overlays: buildSubtitleOverlayPlan(cues),
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toBe(
      "[0:v][1:v]overlay=(W-w)/2:H-h-48:enable='between(t,0,3)'[v0];" +
      "[v0][2:v]overlay=(W-w)/2:H-h-48:enable='between(t,3,5.5)'[vout]"
    );
    expect(args.filter(a => a === '-i')).toHaveLength(3); // concat + 2 PNG
  });

  it('时间窗秒数不带多余的尾零（3.5 而不是 3.500）', () => {
    const args = buildSubtitleMergeArgs({
      listFile: 'concat_list.txt',
      outputName: 'out.mp4',
      overlays: [{ file: 'sub_001.png', startSeconds: 2.25, endSeconds: 3.5 }],
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('between(t,2.25,3.5)');
  });
});

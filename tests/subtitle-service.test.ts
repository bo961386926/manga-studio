import { describe, it, expect } from 'vitest';
import { buildSubtitleCues, formatSrtTimestamp, cuesToSrt, type SubtitleCue } from '../services/subtitleService';
import type { Shot } from '../types';

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 's1',
  sceneId: 'sc1',
  actionSummary: '动作描述',
  cameraMovement: 'static',
  characters: [],
  keyframes: [],
  ...over,
});

const withVideo = (over: Partial<Shot>, duration: number): Shot =>
  shot({ ...over, interval: { id: 'i', startKeyframeId: 'a', endKeyframeId: 'b', duration, motionStrength: 5, videoUrl: 'blob:x', status: 'completed' } });

describe('buildSubtitleCues（字幕时间轴）', () => {
  it('按合并顺序累计时间轴，时长来自 interval.duration', () => {
    const cues = buildSubtitleCues([
      withVideo({ id: 'a', dialogue: '你好' }, 3),
      withVideo({ id: 'b', dialogue: '世界' }, 2.5),
    ]);
    expect(cues.map(c => [c.startSeconds, c.endSeconds, c.text])).toEqual([
      [0, 3, '你好'],
      [3, 5.5, '世界'],
    ]);
    expect(cues.map(c => c.index)).toEqual([1, 2]);
  });

  it('未渲染完成的镜头既不产生字幕也不占时间轴', () => {
    const cues = buildSubtitleCues([
      withVideo({ id: 'a', dialogue: '第一句' }, 3),
      shot({ id: 'b', dialogue: '没有视频' }), // 无 interval.videoUrl
      withVideo({ id: 'c', dialogue: '第二句' }, 2),
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[1]).toMatchObject({ startSeconds: 3, endSeconds: 5, text: '第二句' });
  });

  it('无台词的镜头不产生字幕，但时间轴照常推进', () => {
    const cues = buildSubtitleCues([
      withVideo({ id: 'a', dialogue: '第一句' }, 3),
      withVideo({ id: 'b' }, 4), // 无台词
      withVideo({ id: 'c', dialogue: '第二句' }, 2),
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[1]).toMatchObject({ startSeconds: 7, endSeconds: 9 });
  });

  it('台词为空白字符串时不产生字幕', () => {
    const cues = buildSubtitleCues([withVideo({ id: 'a', dialogue: '   ' }, 2)]);
    expect(cues).toEqual([]);
  });

  it('useActionSummary 模式用动作描述做字幕（无台词项目也能出字幕）', () => {
    const cues = buildSubtitleCues(
      [withVideo({ id: 'a', actionSummary: '角色推门而入' }, 2)],
      { useActionSummary: true }
    );
    expect(cues[0].text).toBe('角色推门而入');
  });

  it('多行台词保留换行结构', () => {
    const cues = buildSubtitleCues([withVideo({ id: 'a', dialogue: '第一行\n第二行' }, 2)]);
    expect(cues[0].text).toBe('第一行\n第二行');
  });

  it('台词首尾空白被裁掉', () => {
    const cues = buildSubtitleCues([withVideo({ id: 'a', dialogue: '  你好\n' }, 2)]);
    expect(cues[0].text).toBe('你好');
  });

  it('没有任何已完成视频时返回空数组而不是报错', () => {
    expect(buildSubtitleCues([shot({ id: 'a' })])).toEqual([]);
  });
});

describe('formatSrtTimestamp（SRT 时间戳）', () => {
  it.each([
    [0, '00:00:00,000'],
    [1.5, '00:00:01,500'],
    [59.999, '00:00:59,999'],
    [60, '00:01:00,000'],
    [3661.5, '01:01:01,500'],
    [7225.25, '02:00:25,250'],
  ])('%s 秒 → %s', (input, expected) => {
    expect(formatSrtTimestamp(input)).toBe(expected);
  });

  it('毫秒进位到秒（0.9995 → 下一秒）', () => {
    expect(formatSrtTimestamp(3.9995)).toBe('00:00:04,000');
  });
});

describe('cuesToSrt（SRT 文本）', () => {
  it('生成标准 SRT 块结构', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startSeconds: 0, endSeconds: 3, text: '你好' },
      { index: 2, startSeconds: 3, endSeconds: 5.5, text: '世界' },
    ];
    const srt = cuesToSrt(cues);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:03,000\n你好\n\n2\n00:00:03,000 --> 00:00:05,500\n世界\n'
    );
  });

  it('多行台词在 SRT 内保留为多行文本', () => {
    const srt = cuesToSrt([{ index: 1, startSeconds: 0, endSeconds: 2, text: '第一行\n第二行' }]);
    expect(srt).toContain('第一行\n第二行');
  });

  it('空字幕列表输出空字符串', () => {
    expect(cuesToSrt([])).toBe('');
  });
});

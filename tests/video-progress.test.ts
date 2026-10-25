/**
 * F5 修复：视频生成进度展示必须是诚实的状态展示。
 * 禁止任何百分比与剩余时间预估——只允许真实状态文案 + 实际已用时。
 * 状态值来源：
 *  - 网关轮询 getJob：queued / polling / submitting / succeeded / failed / cancelled / expired / submission_uncertain
 *  - UI 侧 shot.interval.status（types.ts）：pending / generating / completed / failed
 */
import { describe, it, expect } from 'vitest';
import { getVideoProgressDisplay } from '../components/StageDirector/videoProgress';

describe('videoProgress 诚实状态展示', () => {
  const START = 1_000_000; // 开始时间戳 (ms)
  const at = (elapsedSeconds: number) => START + elapsedSeconds * 1000;

  it.each([
    // 网关轮询状态
    ['queued', '排队中'],
    ['polling', '生成中'],
    ['submitting', '提交中'],
    ['submission_uncertain', '状态待确认'],
    ['succeeded', '已完成'],
    ['failed', '生成失败'],
    ['cancelled', '已取消'],
    ['expired', '已过期'],
    // UI 侧 interval 状态
    ['pending', '排队中'],
    ['generating', '生成中'],
    ['completed', '已完成'],
  ])('把轮询状态 %s 映射为诚实中文文案 "%s"', (status, expected) => {
    const display = getVideoProgressDisplay(status, START, at(5));
    expect(display.stageLabel).toBe(expected);
  });

  it.each([undefined, null, '', 'some-unknown-status'])(
    '未知状态 %s 显示兜底文案"状态未知"',
    (status) => {
      const display = getVideoProgressDisplay(status as string | undefined, START, at(10));
      expect(display.stageLabel).toBe('状态未知');
      expect(display.elapsedLabel).toBe('已用时 00:10');
    }
  );

  it('用时格式化为 mm:ss：0 秒显示 00:00', () => {
    expect(getVideoProgressDisplay('generating', START, at(0)).elapsedLabel).toBe('已用时 00:00');
  });

  it('用时格式化为 mm:ss：65 秒显示 01:05', () => {
    expect(getVideoProgressDisplay('generating', START, at(65)).elapsedLabel).toBe('已用时 01:05');
  });

  it('时钟回拨（当前时间早于开始时间）时用时钳制为 00:00', () => {
    expect(getVideoProgressDisplay('polling', START, START - 5000).elapsedLabel).toBe('已用时 00:00');
  });

  it('超过 1 小时继续如实累计分钟数（61:01），不做小时进位', () => {
    expect(getVideoProgressDisplay('polling', START, at(3661)).elapsedLabel).toBe('已用时 61:01');
  });

  it('展示对象只含 stageLabel 与 elapsedLabel，禁止百分比/剩余时间字段', () => {
    const display = getVideoProgressDisplay('polling', START, at(30));
    expect(Object.keys(display).sort()).toEqual(['elapsedLabel', 'stageLabel']);
    const serialized = JSON.stringify(display);
    expect(serialized).not.toMatch(/%|percent|eta|预计|剩余/);
  });
});

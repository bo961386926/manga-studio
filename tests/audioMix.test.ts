import { describe, it, expect } from 'vitest';
import { buildAudioMixPlan, buildSubtitleMergeArgs } from "../services/videoMerger";
describe('buildAudioMixPlan', () => {
  it('narration + bgm → concat then amix with bgm volume', () => {
    const plan = buildAudioMixPlan({ narrationPaths: ['n1.mp3', 'n2.mp3'], bgmPath: 'bgm.mp3', bgmVolume: 0.25 });
    expect(plan!.inputs).toEqual(['-i', 'n1.mp3', '-i', 'n2.mp3', '-stream_loop', '-1', '-i', 'bgm.mp3']);
    expect(plan!.filter).toBe('[0:a][1:a]concat=n=2:v=0:a=1[narr];[2:a]volume=0.25[bgm];[narr][bgm]amix=inputs=2:duration=first[aout]');
    expect(plan!.outLabel).toBe('aout');
  });
  it('narration only → concat then anull out', () => {
    expect(buildAudioMixPlan({ narrationPaths: ['n1.mp3'] })!.filter)
      .toBe('[0:a]concat=n=1:v=0:a=1[narr];[narr]anull[aout]');
  });
  it('bgm only → volume then out (loop input)', () => {
    const plan = buildAudioMixPlan({ narrationPaths: [], bgmPath: 'bgm.mp3' });
    expect(plan!.inputs).toEqual(['-stream_loop', '-1', '-i', 'bgm.mp3']);
    expect(plan!.filter).toBe('[0:a]volume=0.25[bgm];[bgm]anull[aout]');
  });
  it('nothing → null', () => {
    expect(buildAudioMixPlan({ narrationPaths: [] })).toBeNull();
  });
});
describe('buildSubtitleMergeArgs + audioMix', () => {
  it('offsets audio labels after subtitle PNG inputs and maps aout', () => {
    const plan = buildAudioMixPlan({ narrationPaths: ['n.mp3'], bgmPath: 'bgm.mp3' });
    const args = buildSubtitleMergeArgs({
      listFile: 'list.txt', outputName: 'out.mp4',
      overlays: [{ file: 's1.png', startSeconds: 0, endSeconds: 2 }],
      audioMix: plan!,
    });
    expect(args).toContain('-stream_loop');
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[1:v]');
    expect(fc).toContain('[2:a]concat=n=1:v=0:a=1[narr]');
    expect(fc).toContain('[3:a]volume=0.25[bgm]');
    expect(args.filter(a => a === '-map')).toHaveLength(2);
    expect(args).toContain('[aout]');
  });
});

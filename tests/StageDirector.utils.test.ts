/**
 * StageDirector 工具函数的示范单元测试
 *
 * 选择这个文件作为示范的原因：
 * 1. utils.ts 与 cameraMovementGuides.ts 都是纯函数，无副作用，依赖清晰
 * 2. 覆盖了字符串处理、对象查找、条件分支、回退默认值等典型模式
 * 3. 这些函数会被大量业务逻辑调用（关键帧生成、视频生成），属于高价值回归保护点
 *
 * 命名约定：与被测文件同名 + .test.ts 后缀
 */

import { describe, it, expect } from 'vitest';
import { getRefImagesForShot } from '../components/StageDirector/utils';
import type { Shot, ScriptData, Scene, Character, CharacterVariation } from '../types';

// ──────────────────────────── 测试 fixtures ────────────────────────────

const buildScene = (overrides: Partial<Scene> = {}): Scene => ({
  id: 'scene-1',
  location: 'street',
  time: 'day',
  atmosphere: 'calm',
  ...overrides,
});

const buildCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: 'char-1',
  name: 'Alice',
  gender: 'female',
  age: '25',
  personality: 'curious',
  variations: [],
  ...overrides,
});

const buildShot = (overrides: Partial<Shot> = {}): Shot => ({
  id: 'shot-1',
  sceneId: 'scene-1',
  actionSummary: 'walks forward',
  cameraMovement: 'pan left shot',
  characters: [],
  keyframes: [],
  ...overrides,
});

const buildScriptData = (scenes: Scene[], characters: Character[]): ScriptData => ({
  title: 'Test',
  genre: 'drama',
  logline: 'logline',
  characters,
  scenes,
  storyParagraphs: [],
});

// ──────────────────────────── getRefImagesForShot ────────────────────────────

describe('getRefImagesForShot', () => {
  it('当 scriptData 为 null 时返回空数组', () => {
    const shot = buildShot();
    expect(getRefImagesForShot(shot, null)).toEqual([]);
  });

  it('应当按顺序收集：场景参考图 → 角色变体参考图 → 角色基础参考图', () => {
    const scene = buildScene({ referenceImage: 'scene.png' });
    const variation: CharacterVariation = {
      id: 'var-1',
      name: 'battle',
      visualPrompt: 'battle look',
      referenceImage: 'var.png',
    };
    const char = buildCharacter({
      referenceImage: 'char.png',
      variations: [variation],
    });
    const shot = buildShot({
      characters: ['char-1'],
      characterVariations: { 'char-1': 'var-1' },
    });
    const scriptData = buildScriptData([scene], [char]);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['scene.png', 'var.png']);
  });

  it('角色未指定变体时，应回退到角色基础参考图', () => {
    const char = buildCharacter({ referenceImage: 'char.png' });
    const shot = buildShot({
      characters: ['char-1'],
      // 没有 characterVariations
    });
    const scriptData = buildScriptData([], [char]);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['char.png']);
  });

  it('变体存在但没有 referenceImage 时，回退到角色基础参考图', () => {
    const variation: CharacterVariation = {
      id: 'var-1',
      name: 'battle',
      visualPrompt: 'battle look',
      // 没有 referenceImage
    };
    const char = buildCharacter({
      referenceImage: 'char.png',
      variations: [variation],
    });
    const shot = buildShot({
      characters: ['char-1'],
      characterVariations: { 'char-1': 'var-1' },
    });
    const scriptData = buildScriptData([], [char]);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['char.png']);
  });

  it('场景 ID 与 shot.sceneId 不匹配时，不应返回场景参考图', () => {
    const scene = buildScene({ id: 'scene-other', referenceImage: 'scene.png' });
    const shot = buildShot({ sceneId: 'scene-1' });
    const scriptData = buildScriptData([scene], []);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual([]);
  });

  it('shot.characters 中引用了不存在的角色 ID，应安全跳过', () => {
    const scene = buildScene({ referenceImage: 'scene.png' });
    const shot = buildShot({ characters: ['ghost-id'] });
    const scriptData = buildScriptData([scene], []);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['scene.png']);
  });

  it('shot.characters 为 undefined 时，应只返回场景参考图', () => {
    const scene = buildScene({ referenceImage: 'scene.png' });
    // 显式把 characters 设为 undefined 以覆盖 utils.ts 中的 if (shot.characters) 防御分支
    const shot: Shot = {
      id: 'shot-1',
      sceneId: 'scene-1',
      actionSummary: '',
      cameraMovement: '',
      characters: undefined as unknown as string[],
      keyframes: [],
    };
    const scriptData = buildScriptData([scene], []);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['scene.png']);
  });

  it('多个角色时按数组顺序收集参考图', () => {
    const charA = buildCharacter({ id: 'a', referenceImage: 'a.png' });
    const charB = buildCharacter({ id: 'b', referenceImage: 'b.png' });
    const shot = buildShot({ characters: ['a', 'b'] });
    const scriptData = buildScriptData([], [charA, charB]);

    const result = getRefImagesForShot(shot, scriptData);

    expect(result).toEqual(['a.png', 'b.png']);
  });
});
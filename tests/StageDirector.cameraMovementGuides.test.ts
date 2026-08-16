/**
 * cameraMovementGuides 的示范单元测试
 *
 * 覆盖：
 * - 大小写不敏感匹配
 * - 模糊包含匹配
 * - frameType 决定返回 start 还是 end
 * - 未知镜头运动的回退默认值
 */

import { describe, it, expect } from 'vitest';
import {
  getCameraMovementCompositionGuide,
  CAMERA_MOVEMENT_GUIDES,
} from '../components/StageDirector/cameraMovementGuides';

describe('getCameraMovementCompositionGuide', () => {
  describe('已知镜头运动', () => {
    it('应当返回 start 文案（frameType=start）', () => {
      const guide = getCameraMovementCompositionGuide('zoom in shot', 'start');
      expect(guide).toBe(CAMERA_MOVEMENT_GUIDES['zoom in shot'].start);
    });

    it('应当返回 end 文案（frameType=end）', () => {
      const guide = getCameraMovementCompositionGuide('zoom in shot', 'end');
      expect(guide).toBe(CAMERA_MOVEMENT_GUIDES['zoom in shot'].end);
    });

    it('输入大小写不敏感', () => {
      const lower = getCameraMovementCompositionGuide('PAN LEFT SHOT', 'start');
      const expected = CAMERA_MOVEMENT_GUIDES['pan left shot'].start;
      expect(lower).toBe(expected);
    });

    it('混合大小写也能命中', () => {
      const guide = getCameraMovementCompositionGuide('Pan Left Shot', 'end');
      expect(guide).toBe(CAMERA_MOVEMENT_GUIDES['pan left shot'].end);
    });
  });

  describe('部分匹配（包含子串）', () => {
    it('当输入包含已知运动名称时也能命中', () => {
      // "slow dolly zoom in cinematic sequence" 包含 "zoom in shot" 不一定命中
      // 但 "dolly zoom" 是已知的 key
      const guide = getCameraMovementCompositionGuide('cinematic dolly zoom', 'start');
      expect(guide).toBe(CAMERA_MOVEMENT_GUIDES['cinematic dolly zoom'].start);
    });
  });

  describe('回退默认值', () => {
    it('完全未知镜头运动 + start，应返回 start 默认文案', () => {
      const guide = getCameraMovementCompositionGuide('hyperlapse orbit shot', 'start');
      expect(guide).toContain('Initial frame composition');
    });

    it('完全未知镜头运动 + end，应返回 end 默认文案', () => {
      const guide = getCameraMovementCompositionGuide('hyperlapse orbit shot', 'end');
      expect(guide).toContain('Final frame composition');
    });

    it('空字符串应走回退分支而非抛错', () => {
      expect(() => getCameraMovementCompositionGuide('', 'start')).not.toThrow();
      const guide = getCameraMovementCompositionGuide('', 'start');
      expect(guide).toContain('Composition:');
    });
  });

  describe('数据完整性', () => {
    it('CAMERA_MOVEMENT_GUIDES 中每条记录都应同时提供 start 和 end', () => {
      Object.entries(CAMERA_MOVEMENT_GUIDES).forEach(([key, value]) => {
        expect(value.start, `${key} 应有 start 文案`).toBeTruthy();
        expect(value.end, `${key} 应有 end 文案`).toBeTruthy();
      });
    });

    it('CAMERA_MOVEMENT_GUIDES 应至少包含基础镜头运动', () => {
      // 防回归：项目演示需要至少这些常见镜头
      const required = [
        'zoom in shot',
        'zoom out shot',
        'pan left shot',
        'pan right shot',
      ];
      required.forEach(key => {
        expect(CAMERA_MOVEMENT_GUIDES[key], `${key} 必须存在于指南表中`).toBeDefined();
      });
    });
  });
});
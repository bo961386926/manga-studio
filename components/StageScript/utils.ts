import { Scene } from '../../types';

export const getFinalValue = (selected: string, customInput: string): string => {
  return selected === 'custom' ? customInput : selected;
};

export const deduplicateScenes = (scenes: Scene[] = []): Scene[] => {
  const seenLocations = new Set<string>();
  return scenes.filter(scene => {
    const normalizedLoc = scene.location.trim().toLowerCase();
    if (seenLocations.has(normalizedLoc)) {
      return false;
    }
    seenLocations.add(normalizedLoc);
    return true;
  });
};

export const getTextStats = (text: string) => {
  return {
    characters: text.length,
    lines: text.split('\n').length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0
  };
};

export const validateConfig = (config: {
  script: string;
  duration: string;
  model: string;
  visualStyle: string;
}): { valid: boolean; error: string | null } => {
  if (!config.script.trim()) {
    return { valid: false, error: '请输入剧本内容。' };
  }
  if (!config.duration) {
    return { valid: false, error: '请选择目标时长。' };
  }
  if (!config.model) {
    return { valid: false, error: '请选择或输入模型名称。' };
  }
  if (!config.visualStyle) {
    return { valid: false, error: '请选择或输入视觉风格。' };
  }
  return { valid: true, error: null };
};

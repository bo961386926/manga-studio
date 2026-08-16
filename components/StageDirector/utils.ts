import { Shot, ProjectState, Keyframe } from '../../types';
import { VISUAL_STYLE_PROMPTS, VIDEO_PROMPT_TEMPLATES } from './constants';
import { getCameraMovementCompositionGuide } from './cameraMovementGuides';

export const getRefImagesForShot = (shot: Shot, scriptData: ProjectState['scriptData']): string[] => {
  const referenceImages: string[] = [];
  
  if (!scriptData) return referenceImages;
  
  // 参考图优先使用场景氛围，再使用角色变体或基础形象。
  const scene = scriptData.scenes.find(s => String(s.id) === String(shot.sceneId));
  if (scene?.referenceImage) {
    referenceImages.push(scene.referenceImage);
  }

  let characterIds: string[] = [];
  const chars = shot.characters as any;
  if (Array.isArray(chars)) {
    characterIds = chars;
  } else if (typeof chars === 'string' && chars.trim()) {
    characterIds = chars.split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  if (characterIds.length > 0) {
    characterIds.forEach(charId => {
      const char = scriptData.characters.find(c => String(c.id) === String(charId));
      if (!char) return;

      const varId = shot.characterVariations?.[charId];
      if (varId) {
        const variation = char.variations?.find(v => v.id === varId);
        if (variation?.referenceImage) {
          referenceImages.push(variation.referenceImage);
          return;
        }
      }

      if (char.referenceImage) {
        referenceImages.push(char.referenceImage);
      }
    });
  }
  
  return referenceImages;
};

export const buildKeyframePrompt = (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end'
): string => {
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  const cameraGuide = getCameraMovementCompositionGuide(cameraMovement, frameType);
  
  const frameSpecificGuide = frameType === 'start' 
    ? `【起始帧要求】建立清晰的初始状态和场景氛围,人物/物体的起始位置、姿态和表情要明确,为后续运动预留视觉空间和动势。`
    : `【结束帧要求】展现动作完成后的最终状态,人物/物体的终点位置、姿态和情绪变化,体现镜头运动带来的视角变化。`;

  const characterConsistencyGuide = `【角色一致性要求】CHARACTER CONSISTENCY REQUIREMENTS - CRITICAL
⚠️ 如果提供了角色参考图,画面中的人物外观必须严格遵循参考图:
• 面部特征: 五官轮廓、眼睛颜色和形状、鼻子和嘴巴的结构必须完全一致
• 发型发色: 头发的长度、颜色、质感、发型样式必须保持一致
• 服装造型: 服装的款式、颜色、材质、配饰必须与参考图匹配
• 体型特征: 身材比例、身高体型必须保持一致
⚠️ 这是最高优先级要求,不可妥协!`;

  return `${basePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【视觉风格】Visual Style
${stylePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【镜头运动】Camera Movement
${cameraMovement} (${frameType === 'start' ? 'Initial Frame 起始帧' : 'Final Frame 结束帧'})

【构图指导】Composition Guide
${cameraGuide}

${frameSpecificGuide}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${characterConsistencyGuide}`;
};

export const buildKeyframePromptWithAI = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  enhanceWithAI: boolean = true
): Promise<string> => {
  const basicPrompt = buildKeyframePrompt(basePrompt, visualStyle, cameraMovement, frameType);
  
  if (!enhanceWithAI) {
    return basicPrompt;
  }
  
  // 动态导入避免与模型服务形成循环依赖。
  try {
    const { enhanceKeyframePrompt } = await import('../../services/geminiService');
    const enhanced = await enhanceKeyframePrompt(basicPrompt, visualStyle, cameraMovement, frameType);
    return enhanced;
  } catch (error) {
    console.error('AI增强失败,使用基础提示词:', error);
    return basicPrompt;
  }
};

export const buildVideoPrompt = (
  actionSummary: string,
  cameraMovement: string,
  videoModel: 'sora-2' | 'veo' | 'veo_3_1_t2v_fast_landscape' | 'veo_3_1_t2v_fast_portrait' | 'veo_3_1_i2v_s_fast_fl_landscape' | 'veo_3_1_i2v_s_fast_fl_portrait' | string,
  language: string
): string => {
  const isChinese = language === '中文' || language === 'Chinese';
  
  if (videoModel === 'sora-2') {
    const template = isChinese 
      ? VIDEO_PROMPT_TEMPLATES.sora2.chinese 
      : VIDEO_PROMPT_TEMPLATES.sora2.english;
    
    return template
      .replace('{actionSummary}', actionSummary)
      .replace('{cameraMovement}', cameraMovement)
      .replace('{language}', language);
  } else {
    return VIDEO_PROMPT_TEMPLATES.veo.simple
      .replace('{actionSummary}', actionSummary)
      .replace('{cameraMovement}', cameraMovement)
      .replace('{language}', isChinese ? '中文' : language);
  }
};

export const extractBasePrompt = (fullPrompt: string, fallback: string): string => {
  const visualStyleIndex = fullPrompt.indexOf('\n\nVisual Style:');
  if (visualStyleIndex > 0) {
    return fullPrompt.substring(0, visualStyleIndex);
  }
  return fullPrompt || fallback;
};

export const generateId = (prefix: string): string => {
  return `${prefix}-${Date.now()}`;
};

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      resolve(event.target?.result as string);
    };
    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };
    reader.readAsDataURL(file);
  });
};

export const createKeyframe = (
  id: string,
  type: 'start' | 'end',
  visualPrompt: string,
  imageUrl?: string,
  status: 'pending' | 'generating' | 'completed' | 'failed' = 'pending'
): Keyframe => {
  return {
    id,
    type,
    visualPrompt,
    imageUrl,
    status
  };
};

export const updateKeyframeInShot = (
  shot: Shot,
  type: 'start' | 'end',
  keyframe: Keyframe
): Shot => {
  const newKeyframes = [...(shot.keyframes || [])];
  const idx = newKeyframes.findIndex(k => k.type === type);
  
  if (idx >= 0) {
    newKeyframes[idx] = keyframe;
  } else {
    newKeyframes.push(keyframe);
  }
  
  return { ...shot, keyframes: newKeyframes };
};

export const generateSubShotIds = (originalShotId: string, count: number): string[] => {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${originalShotId}-${i}`);
  }
  return ids;
};

export const createSubShot = (
  originalShot: Shot,
  subShotData: any,
  subShotId: string
): Shot => {
  const keyframes: any[] = [];
  if (subShotData.keyframes && Array.isArray(subShotData.keyframes)) {
    subShotData.keyframes.forEach((kf: any) => {
      if (kf.type && kf.visualPrompt) {
        keyframes.push({
          id: `${subShotId}-${kf.type}`,
          type: kf.type,
          visualPrompt: kf.visualPrompt,
          status: 'pending'
        });
      }
    });
  }
  
  return {
    id: subShotId,
    sceneId: originalShot.sceneId,
    actionSummary: subShotData.actionSummary,
    dialogue: undefined,
    cameraMovement: subShotData.cameraMovement,
    shotSize: subShotData.shotSize,
    characters: Array.isArray(originalShot.characters)
      ? [...originalShot.characters]
      : (typeof originalShot.characters === 'string'
         ? (originalShot.characters as string).split(',').map(s => s.trim()).filter(Boolean)
         : []),
    characterVariations: { ...originalShot.characterVariations },
    keyframes: keyframes,
    videoModel: originalShot.videoModel
  };
};

export const replaceShotWithSubShots = (
  shots: Shot[],
  originalShotId: string,
  subShots: Shot[]
): Shot[] => {
  const originalIndex = shots.findIndex(s => s.id === originalShotId);
  
  if (originalIndex === -1) {
    console.error(`未找到ID为 ${originalShotId} 的镜头`);
    return shots;
  }
  
  const newShots = [
    ...shots.slice(0, originalIndex),
    ...subShots,
    ...shots.slice(originalIndex + 1)
  ];
  
  return newShots;
};
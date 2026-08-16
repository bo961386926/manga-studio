import { REGIONAL_FEATURES, LANGUAGE_MAP, DEFAULTS } from './constants';
import { convertImageToBase64 } from '../../services/storageService';

export const getRegionalPrefix = (
  language: string,
  type: 'character' | 'scene'
): string => {
  const mappedLanguage = LANGUAGE_MAP[language];
  if (!mappedLanguage) return '';
  
  const features = REGIONAL_FEATURES[mappedLanguage];
  return features ? features[type] : '';
};

export const handleImageUpload = async (file: File): Promise<string> => {
  try {
    return await convertImageToBase64(file);
  } catch (e: any) {
    console.error('图片上传失败:', e);
    throw new Error(e.message || '图片上传失败');
  }
};

export const getProjectLanguage = (
  projectLanguage?: string,
  scriptLanguage?: string
): string => {
  return projectLanguage || scriptLanguage || DEFAULTS.language;
};

export const getProjectVisualStyle = (
  projectVisualStyle?: string,
  scriptVisualStyle?: string
): string => {
  return projectVisualStyle || scriptVisualStyle || DEFAULTS.visualStyle;
};

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const generateId = (prefix: string = 'id'): string => {
  return `${prefix}-${Date.now()}`;
};

export const compareIds = (id1: string | number, id2: string | number): boolean => {
  return String(id1) === String(id2);
};

import { AssetLibraryItem, Character, ProjectState, Scene } from '../types';

const generateId = (prefix: string): string => {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
};

const cloneCharacterVariation = (variation: Character['variations'][number]) => ({
  ...variation,
  id: generateId('var'),
  status: (variation.referenceImage ? 'completed' : 'pending') as Character['variations'][number]['status']
});

export const createLibraryItemFromCharacter = (character: Character): AssetLibraryItem => {
  const now = Date.now();
  return {
    id: generateId('asset'),
    type: 'character',
    name: character.name,
    createdAt: now,
    updatedAt: now,
    data: {
      ...character,
      variations: (character.variations || []).map((v) => ({ ...v }))
    }
  };
};

export const createLibraryItemFromScene = (scene: Scene): AssetLibraryItem => {
  const now = Date.now();
  return {
    id: generateId('asset'),
    type: 'scene',
    name: scene.location,
    createdAt: now,
    updatedAt: now,
    data: { ...scene }
  };
};

export const cloneCharacterForProject = (character: Character): Character => {
  return {
    ...character,
    id: generateId('char'),
    variations: (character.variations || []).map(cloneCharacterVariation),
    status: character.referenceImage ? 'completed' : 'pending'
  };
};

export const cloneSceneForProject = (scene: Scene): Scene => {
  return {
    ...scene,
    id: generateId('scene'),
    status: scene.referenceImage ? 'completed' : 'pending'
  };
};

export const applyLibraryItemToProject = (project: ProjectState, item: AssetLibraryItem): ProjectState => {
  if (!project.scriptData) {
    throw new Error('项目尚未生成角色和场景，无法导入资产。');
  }

  const newData = { ...project.scriptData };

  if (item.type === 'character') {
    const character = cloneCharacterForProject(item.data as Character);
    newData.characters = [...newData.characters, character];
  } else {
    const scene = cloneSceneForProject(item.data as Scene);
    newData.scenes = [...newData.scenes, scene];
  }

  return {
    ...project,
    scriptData: newData
  };
};

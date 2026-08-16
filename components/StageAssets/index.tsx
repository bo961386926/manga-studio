// Author: forsearch | Updated: 2026-04-30
import React, { useState, useEffect } from 'react';
import { Users, Sparkles, RefreshCw, Loader2, MapPin, Archive, X, Search, Trash2 } from 'lucide-react';
import { ProjectState, CharacterVariation, Character, Scene, AspectRatio, AssetLibraryItem } from '../../types';
import { generateImage, generateVisualPrompts } from '../../services/geminiService';
import { 
  getRegionalPrefix, 
  handleImageUpload, 
  getProjectLanguage, 
  getProjectVisualStyle,
  delay,
  generateId,
  compareIds 
} from './utils';
import { DEFAULTS, STYLES, GRID_LAYOUTS } from './constants';
import ImagePreviewModal from './ImagePreviewModal';
import CharacterCard from './CharacterCard';
import SceneCard from './SceneCard';
import WardrobeModal from './WardrobeModal';
import { useAlert } from '../GlobalAlert';
import { getAllAssetLibraryItems, saveAssetToLibrary, deleteAssetFromLibrary } from '../../services/storageService';
import { applyLibraryItemToProject, createLibraryItemFromCharacter, createLibraryItemFromScene, cloneCharacterForProject } from '../../services/assetLibraryService';
import { AspectRatioSelector } from '../AspectRatioSelector';
import { getDefaultAspectRatio, getImageModels, getActiveImageModel, getModelById } from '../../services/modelRegistry';
import ModelSelector from '../ModelSelector';
import { ImageModelDefinition } from '../../types/model';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onApiKeyError?: (error: any) => boolean;
}

const StageAssets: React.FC<Props> = ({ project, updateProject, onApiKeyError }) => {
  const { showAlert } = useAlert();
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene'>('all');
  const [replaceTargetCharId, setReplaceTargetCharId] = useState<string | null>(null);
  
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => getDefaultAspectRatio());
  
  const defaultImageModel = getActiveImageModel();
  const [selectedImageModelId, setSelectedImageModelId] = useState<string>(
    defaultImageModel?.id || 'gemini-3-pro-image-preview'
  );

  const language = getProjectLanguage(project.language, project.scriptData?.language);
  const visualStyle = getProjectVisualStyle(project.visualStyle, project.scriptData?.visualStyle);
  const genre = project.scriptData?.genre || DEFAULTS.genre;

  // 页面重开后可能保留 generating 状态，需要回退为 failed 让用户能重新生成。
  useEffect(() => {
    if (!project.scriptData) return;

    const hasStuckCharacters = project.scriptData.characters.some(char => {
      const isCharStuck = char.status === 'generating' && !char.referenceImage;
      const hasStuckVariations = char.variations?.some(v => v.status === 'generating' && !v.referenceImage);
      return isCharStuck || hasStuckVariations;
    });

    const hasStuckScenes = project.scriptData.scenes.some(scene => 
      scene.status === 'generating' && !scene.referenceImage
    );

    if (hasStuckCharacters || hasStuckScenes) {
      const newData = { ...project.scriptData };
      
      newData.characters = newData.characters.map(char => ({
        ...char,
        status: char.status === 'generating' && !char.referenceImage ? 'failed' as const : char.status,
        variations: char.variations?.map(v => ({
          ...v,
          status: v.status === 'generating' && !v.referenceImage ? 'failed' as const : v.status
        }))
      }));
      
      newData.scenes = newData.scenes.map(scene => ({
        ...scene,
        status: scene.status === 'generating' && !scene.referenceImage ? 'failed' as const : scene.status
      }));
      
      updateProject({ scriptData: newData });
    }
  }, [project.id]);

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    try {
      const items = await getAllAssetLibraryItems();
      setLibraryItems(items);
    } catch (e) {
      console.error('Failed to load asset library', e);
    } finally {
      setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (showLibraryModal) {
      refreshLibrary();
    }
  }, [showLibraryModal]);

  const openLibrary = (filter: 'all' | 'character' | 'scene', targetCharId: string | null = null) => {
    setLibraryFilter(filter);
    setReplaceTargetCharId(targetCharId);
    setShowLibraryModal(true);
  };

  const handleGenerateAsset = async (type: 'character' | 'scene', id: string) => {
    if (project.scriptData) {
      const newData = { ...project.scriptData };
      if (type === 'character') {
        const c = newData.characters.find(c => compareIds(c.id, id));
        if (c) c.status = 'generating';
      } else {
        const s = newData.scenes.find(s => compareIds(s.id, id));
        if (s) s.status = 'generating';
      }
      updateProject({ scriptData: newData });
    }
    try {
      let prompt = "";
      
      if (type === 'character') {
        const char = project.scriptData?.characters.find(c => compareIds(c.id, id));
        if (char) {
          if (char.visualPrompt) {
            prompt = char.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('character', char, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            if (project.scriptData) {
              const newData = { ...project.scriptData };
              const c = newData.characters.find(c => compareIds(c.id, id));
              if (c) {
                c.visualPrompt = prompts.visualPrompt;
                c.negativePrompt = prompts.negativePrompt;
              }
              updateProject({ scriptData: newData });
            }
          }
        }
      } else {
        const scene = project.scriptData?.scenes.find(s => compareIds(s.id, id));
        if (scene) {
          if (scene.visualPrompt) {
            prompt = scene.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('scene', scene, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            if (project.scriptData) {
              const newData = { ...project.scriptData };
              const s = newData.scenes.find(s => compareIds(s.id, id));
              if (s) {
                s.visualPrompt = prompts.visualPrompt;
                s.negativePrompt = prompts.negativePrompt;
              }
              updateProject({ scriptData: newData });
            }
          }
        }
      }

      const regionalPrefix = getRegionalPrefix(language, type);
      const enhancedPrompt = regionalPrefix + prompt;

      console.log(`[StageAssets] handleGenerateAsset - type: ${type}, id: ${id}, prompt length: ${enhancedPrompt.length}`);
      const imageUrl = await generateImage(enhancedPrompt, [], aspectRatio);
      console.log(`[StageAssets] handleGenerateAsset - 图片生成成功`);

      if (project.scriptData) {
        const newData = { ...project.scriptData };
        if (type === 'character') {
          const c = newData.characters.find(c => compareIds(c.id, id));
          if (c) {
            c.referenceImage = imageUrl;
            c.status = 'completed';
          }
        } else {
          const s = newData.scenes.find(s => compareIds(s.id, id));
          if (s) {
            s.referenceImage = imageUrl;
            s.status = 'completed';
          }
        }
        updateProject({ scriptData: newData });
      }

    } catch (e: any) {
      console.error(`[StageAssets] 生成 ${type === 'character' ? '角色' : '场景'} 图片失败:`, e);
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        if (type === 'character') {
          const c = newData.characters.find(c => compareIds(c.id, id));
          if (c) c.status = 'failed';
        } else {
          const s = newData.scenes.find(s => compareIds(s.id, id));
          if (s) s.status = 'failed';
        }
        updateProject({ scriptData: newData });
      }
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
      showAlert(`图片生成失败: ${e.message || '未知错误'}`, { type: 'error' });
    }
  };

  const handleBatchGenerate = async (type: 'character' | 'scene') => {
    const items = type === 'character' 
      ? project.scriptData?.characters 
      : project.scriptData?.scenes;
    
    if (!items) return;

    const itemsToGen = items.filter(i => !i.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert(`确定要重新生成所有${type === 'character' ? '角色' : '场景'}图吗？`, {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerate(items, type);
        }
      });
      return;
    }

    await executeBatchGenerate(itemsToGen, type);
  };

  const executeBatchGenerate = async (targetItems: any[], type: 'character' | 'scene') => {
    setBatchProgress({ current: 0, total: targetItems.length });

    for (let i = 0; i < targetItems.length; i++) {
      if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
      
      await handleGenerateAsset(type, targetItems[i].id);
      setBatchProgress({ current: i + 1, total: targetItems.length });
    }

    setBatchProgress(null);
  };

  const handleUploadCharacterImage = async (charId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        if (char) {
          char.referenceImage = base64;
        }
        updateProject({ scriptData: newData });
      }
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleUploadSceneImage = async (sceneId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
        if (scene) {
          scene.referenceImage = base64;
        }
        updateProject({ scriptData: newData });
      }
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleAddCharacterToLibrary = (char: Character) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromCharacter(char);
        await saveAssetToLibrary(item);
        showAlert(`已加入资产库：${char.name}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!char.referenceImage) {
      showAlert('该角色暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleAddSceneToLibrary = (scene: Scene) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromScene(scene);
        await saveAssetToLibrary(item);
        showAlert(`已加入资产库：${scene.location}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!scene.referenceImage) {
      showAlert('该场景暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleImportFromLibrary = (item: AssetLibraryItem) => {
    try {
      const updated = applyLibraryItemToProject(project, item);
      updateProject(() => updated);
      showAlert(`已导入：${item.name}`, { type: 'success' });
    } catch (e: any) {
      showAlert(e?.message || '导入失败', { type: 'error' });
    }
  };

  const handleReplaceCharacterFromLibrary = (item: AssetLibraryItem, targetId: string) => {
    if (item.type !== 'character') {
      showAlert('请选择角色资产进行替换', { type: 'warning' });
      return;
    }
    if (!project.scriptData) return;

    const newData = { ...project.scriptData };
    const index = newData.characters.findIndex((c) => compareIds(c.id, targetId));
    if (index === -1) return;

    const cloned = cloneCharacterForProject(item.data as Character);
    const previous = newData.characters[index];

    newData.characters[index] = {
      ...cloned,
      id: previous.id
    };

    const nextShots = project.shots.map((shot) => {
      if (!shot.characterVariations || !shot.characterVariations[targetId]) return shot;
      const { [targetId]: _removed, ...rest } = shot.characterVariations;
      return {
        ...shot,
        characterVariations: Object.keys(rest).length > 0 ? rest : undefined
      };
    });

    updateProject({ scriptData: newData, shots: nextShots });
    showAlert(`已替换角色：${previous.name} → ${cloned.name}`, { type: 'success' });
    setShowLibraryModal(false);
    setReplaceTargetCharId(null);
  };

  const handleDeleteLibraryItem = async (itemId: string) => {
    try {
      await deleteAssetFromLibrary(itemId);
      setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (e: any) {
      showAlert(e?.message || '删除资产失败', { type: 'error' });
    }
  };

  const handleSaveCharacterPrompt = (charId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      char.visualPrompt = newPrompt;
      updateProject({ scriptData: newData });
    }
  };

  const handleUpdateCharacterInfo = (charId: string, updates: { name?: string; gender?: string; age?: string; personality?: string }) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      if (updates.name !== undefined) char.name = updates.name;
      if (updates.gender !== undefined) char.gender = updates.gender;
      if (updates.age !== undefined) char.age = updates.age;
      if (updates.personality !== undefined) char.personality = updates.personality;
      updateProject({ scriptData: newData });
    }
  };

  const handleSaveScenePrompt = (sceneId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      scene.visualPrompt = newPrompt;
      updateProject({ scriptData: newData });
    }
  };

  const handleUpdateSceneInfo = (sceneId: string, updates: { location?: string; time?: string; atmosphere?: string }) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      if (updates.location !== undefined) scene.location = updates.location;
      if (updates.time !== undefined) scene.time = updates.time;
      if (updates.atmosphere !== undefined) scene.atmosphere = updates.atmosphere;
      updateProject({ scriptData: newData });
    }
  };

  const handleAddCharacter = () => {
    if (!project.scriptData) return;
    
    const newChar: Character = {
      id: generateId('char'),
      name: '新角色',
      gender: '未设定',
      age: '未设定',
      personality: '待补充',
      visualPrompt: '',
      variations: [],
      status: 'pending'
    };

    const newData = { ...project.scriptData };
    newData.characters.push(newChar);
    updateProject({ scriptData: newData });
    showAlert('新角色已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  const handleDeleteCharacter = (charId: string) => {
    if (!project.scriptData) return;
    const char = project.scriptData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    showAlert(
      `确定要删除角色 "${char.name}" 吗？\n\n注意：这将会影响所有使用该角色的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除角色',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          const newData = { ...project.scriptData! };
          newData.characters = newData.characters.filter(c => !compareIds(c.id, charId));
          updateProject({ scriptData: newData });
          showAlert(`角色 "${char.name}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  const handleAddScene = () => {
    if (!project.scriptData) return;
    
    const newScene: Scene = {
      id: generateId('scene'),
      location: '新场景',
      time: '未设定',
      atmosphere: '待补充',
      visualPrompt: '',
      status: 'pending'
    };

    const newData = { ...project.scriptData };
    newData.scenes.push(newScene);
    updateProject({ scriptData: newData });
    showAlert('新场景已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  const handleDeleteScene = (sceneId: string) => {
    if (!project.scriptData) return;
    const scene = project.scriptData.scenes.find(s => compareIds(s.id, sceneId));
    if (!scene) return;

    showAlert(
      `确定要删除场景 "${scene.location}" 吗？\n\n注意：这将会影响所有使用该场景的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除场景',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          const newData = { ...project.scriptData! };
          newData.scenes = newData.scenes.filter(s => !compareIds(s.id, sceneId));
          updateProject({ scriptData: newData });
          showAlert(`场景 "${scene.location}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  const handleAddVariation = (charId: string, name: string, prompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    const newVar: CharacterVariation = {
      id: generateId('var'),
      name: name || "New Outfit",
      visualPrompt: prompt || char.visualPrompt || "",
      referenceImage: undefined
    };

    if (!char.variations) char.variations = [];
    char.variations.push(newVar);
    
    updateProject({ scriptData: newData });
  };

  const handleDeleteVariation = (charId: string, varId: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;
    
    char.variations = char.variations?.filter(v => !compareIds(v.id, varId));
    updateProject({ scriptData: newData });
  };

  const handleGenerateVariation = async (charId: string, varId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    const variation = char?.variations?.find(v => compareIds(v.id, varId));
    if (!char || !variation) return;

    if (project.scriptData) {
      const newData = { ...project.scriptData };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      const v = c?.variations?.find(v => compareIds(v.id, varId));
      if (v) v.status = 'generating';
      updateProject({ scriptData: newData });
    }
    try {
      const refImages = char.referenceImage ? [char.referenceImage] : [];
      const regionalPrefix = getRegionalPrefix(language, 'character');
      const enhancedPrompt = `${regionalPrefix}Character "${char.name}" wearing NEW OUTFIT: ${variation.visualPrompt}. This is a costume/outfit change - the character's face and identity must remain identical to the reference, but they should be wearing the described new outfit.`;
      
      const imageUrl = await generateImage(enhancedPrompt, refImages, aspectRatio, true);

      const newData = { ...project.scriptData! };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      const v = c?.variations?.find(v => compareIds(v.id, varId));
      if (v) {
        v.referenceImage = imageUrl;
        v.status = 'completed';
      }

      updateProject({ scriptData: newData });
    } catch (e: any) {
      console.error(e);
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        const v = c?.variations?.find(v => compareIds(v.id, varId));
        if (v) v.status = 'failed';
        updateProject({ scriptData: newData });
      }
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
      showAlert("Variation generation failed", { type: 'error' });
    }
  };

  const handleUploadVariationImage = async (charId: string, varId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        const variation = char?.variations?.find(v => compareIds(v.id, varId));
        if (variation) {
          variation.referenceImage = base64;
        }
        updateProject({ scriptData: newData });
      }
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  if (!project.scriptData) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950/35 text-slate-500 backdrop-blur-sm">
        <p>请先完成 Phase 01 剧情创作</p>
      </div>
    );
  }
  
  const allCharactersReady = project.scriptData.characters.every(c => c.referenceImage);
  const allScenesReady = project.scriptData.scenes.every(s => s.referenceImage);
  const selectedChar = project.scriptData.characters.find(c => compareIds(c.id, selectedCharId));
  const filteredLibraryItems = libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    if (!libraryQuery.trim()) return true;
    const query = libraryQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query);
  });

  return (
    <div className={STYLES.mainContainer}>
      
      <ImagePreviewModal 
        imageUrl={previewImage} 
        onClose={() => setPreviewImage(null)} 
      />

      {batchProgress && (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-12 h-12 text-cyan-300 animate-spin mb-6" />
          <h3 className="text-xl font-bold text-white mb-2">正在批量生成资源...</h3>
          <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden mb-2">
            <div 
              className="h-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-300" 
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-zinc-400 font-mono text-xs">
            进度: {batchProgress.current} / {batchProgress.total}
          </p>
        </div>
      )}

      {selectedChar && (
        <WardrobeModal
          character={selectedChar}
          onClose={() => setSelectedCharId(null)}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onGenerateVariation={handleGenerateVariation}
          onUploadVariation={handleUploadVariationImage}
          onImageClick={setPreviewImage}
        />
      )}

      {showLibraryModal && (
        <div className={STYLES.modalOverlay} onClick={() => {
          setShowLibraryModal(false);
          setReplaceTargetCharId(null);
        }}>
          <div className={STYLES.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={STYLES.modalHeader}>
              <div className="flex items-center gap-3">
                <Archive className="w-4 h-4 text-cyan-300" />
                <div>
                  <div className="text-sm font-bold text-white">资产库</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                    {libraryItems.length} assets
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowLibraryModal(false);
                  setReplaceTargetCharId(null);
                }}
                className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-xl"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={STYLES.modalBody}>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="搜索资产名称..."
                    className="w-full pl-9 pr-3 py-2 bg-white/[0.06] border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40"
                  />
                </div>
                <div className="flex gap-2">
                  {(['all', 'character', 'scene'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setLibraryFilter(type)}
                      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border rounded ${
                        libraryFilter === type
                          ? 'bg-cyan-300 text-slate-950 border-cyan-300'
                          : 'bg-white/[0.04] text-slate-400 border-white/10 hover:text-white hover:border-cyan-300/30'
                      }`}
                    >
                      {type === 'all' ? '全部' : type === 'character' ? '角色' : '场景'}
                    </button>
                  ))}
                </div>
              </div>

              {libraryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : filteredLibraryItems.length === 0 ? (
                <div className="border border-dashed border-cyan-200/15 rounded-2xl p-10 text-center text-slate-500 text-sm">
                  暂无资产。可在角色或场景卡片中选择“加入资产库”。
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredLibraryItems.map((item) => {
                    const preview =
                      item.type === 'character'
                        ? (item.data as Character).referenceImage
                        : (item.data as Scene).referenceImage;
                    return (
                      <div
                        key={item.id}
                        className="bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden hover:border-cyan-200/35 transition-colors backdrop-blur"
                      >
                        <div className="aspect-video bg-slate-950/70 relative">
                          {preview ? (
                            <img src={preview} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                              {item.type === 'character' ? (
                                <Users className="w-8 h-8 opacity-30" />
                              ) : (
                                <MapPin className="w-8 h-8 opacity-30" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <div className="text-sm text-white font-bold line-clamp-1">{item.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest mt-1">
                              {item.type === 'character' ? '角色' : '场景'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                replaceTargetCharId
                                  ? handleReplaceCharacterFromLibrary(item, replaceTargetCharId)
                                  : handleImportFromLibrary(item)
                              }
                              className="flex-1 py-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {replaceTargetCharId ? '替换当前角色' : '导入到当前项目'}
                            </button>
                            <button
                              onClick={() =>
                                showAlert('确定从资产库删除该资源吗？', {
                                  type: 'warning',
                                  showCancel: true,
                                  onConfirm: () => handleDeleteLibraryItem(item.id)
                                })
                              }
                              className="p-2 border border-white/10 text-slate-500 hover:text-red-300 hover:border-red-400/40 rounded-xl transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={STYLES.header}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-3">
                  <Users className="w-5 h-5 text-cyan-300" />
            场景角色
            <span className="text-xs text-cyan-100/40 font-mono font-normal uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full">
              Assets & Casting
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openLibrary('all')}
            disabled={!!batchProgress}
            className={STYLES.secondaryButton}
          >
            <Archive className="w-4 h-4" />
            资产库
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase">模型</span>
            <ModelSelector
              type="image"
              value={selectedImageModelId}
              onChange={setSelectedImageModelId}
              disabled={!!batchProgress}
              compact
            />
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase">比例</span>
            <AspectRatioSelector
              value={aspectRatio}
              onChange={setAspectRatio}
              allowSquare={(() => {
                const selectedModel = getModelById(selectedImageModelId) as ImageModelDefinition | undefined;
                return selectedModel?.params?.supportedAspectRatios?.includes('1:1') ?? false;
              })()}
              disabled={!!batchProgress}
            />
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex gap-2">
            <span className={STYLES.badge}>
              {project.scriptData.characters.length} CHARS
            </span>
            <span className={STYLES.badge}>
              {project.scriptData.scenes.length} SCENES
            </span>
          </div>
        </div>
      </div>

      <div className={STYLES.content}>
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-cyan-300 rounded-full shadow-lg shadow-cyan-300/40" />
                角色定妆 (Casting)
              </h3>
              <p className="text-xs text-zinc-500 mt-1 pl-3.5">为剧本中的角色生成一致的参考形象</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddCharacter}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-white/10"
              >
                <Users className="w-3 h-3" />
                新建角色
              </button>
              <button 
                onClick={() => openLibrary('character')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                从资产库选择
              </button>
              <button 
                onClick={() => handleBatchGenerate('character')}
                disabled={!!batchProgress}
                className={allCharactersReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allCharactersReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allCharactersReady ? '重新生成所有角色' : '一键生成所有角色'}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.characters.map((char) => (
              <CharacterCard
                key={char.id}
                character={char}
                isGenerating={char.status === 'generating'}
                onGenerate={() => handleGenerateAsset('character', char.id)}
                onUpload={(file) => handleUploadCharacterImage(char.id, file)}
                onPromptSave={(newPrompt) => handleSaveCharacterPrompt(char.id, newPrompt)}
                onOpenWardrobe={() => setSelectedCharId(char.id)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteCharacter(char.id)}
                onUpdateInfo={(updates) => handleUpdateCharacterInfo(char.id, updates)}
                onAddToLibrary={() => handleAddCharacterToLibrary(char)}
                onReplaceFromLibrary={() => openLibrary('character', char.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between mb-6 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                场景概念 (Locations)
              </h3>
              <p className="text-xs text-zinc-500 mt-1 pl-3.5">为剧本场景生成环境参考图</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddScene}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-white/10"
              >
                <MapPin className="w-3 h-3" />
                新建场景
              </button>
              <button 
                onClick={() => openLibrary('scene')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                从资产库选择
              </button>
              <button 
                onClick={() => handleBatchGenerate('scene')}
                disabled={!!batchProgress}
                className={allScenesReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allScenesReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allScenesReady ? '重新生成所有场景' : '一键生成所有场景'}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isGenerating={scene.status === 'generating'}
                onGenerate={() => handleGenerateAsset('scene', scene.id)}
                onUpload={(file) => handleUploadSceneImage(scene.id, file)}
                onPromptSave={(newPrompt) => handleSaveScenePrompt(scene.id, newPrompt)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteScene(scene.id)}
                onUpdateInfo={(updates) => handleUpdateSceneInfo(scene.id, updates)}
                onAddToLibrary={() => handleAddSceneToLibrary(scene)}
              />
            ))}
          </div>
        </section>
      </div>

    </div>
  );
};

export default StageAssets;

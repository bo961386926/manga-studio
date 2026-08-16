import React from 'react';
import { ChevronLeft, ChevronRight, X, Film, Edit2, MessageSquare, Sparkles, Loader2, Scissors } from 'lucide-react';
import { Shot, Character, Scene, ProjectState, AspectRatio, VideoDuration } from '../../types';
import SceneContext from './SceneContext';
import KeyframeEditor from './KeyframeEditor';
import VideoGenerator from './VideoGenerator';

interface ShotWorkbenchProps {
  shot: Shot;
  shotIndex: number;
  totalShots: number;
  scriptData?: ProjectState['scriptData'];
  nextShotHasStartFrame?: boolean;
  isAIOptimizing?: boolean;
  isSplittingShot?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onEditActionSummary: () => void;
  onGenerateAIAction: () => void;
  onSplitShot: () => void;
  onAddCharacter: (charId: string) => void;
  onRemoveCharacter: (charId: string) => void;
  onVariationChange: (charId: string, varId: string) => void;
  onSceneChange: (sceneId: string) => void;
  onGenerateKeyframe: (type: 'start' | 'end') => void;
  onUploadKeyframe: (type: 'start' | 'end') => void;
  onEditKeyframePrompt: (type: 'start' | 'end', prompt: string) => void;
  onOptimizeKeyframeWithAI: (type: 'start' | 'end') => void;
  onOptimizeBothKeyframes: () => void;
  onCopyPreviousEndFrame: () => void;
  onCopyNextStartFrame: () => void;
  useAIEnhancement: boolean;
  onToggleAIEnhancement: () => void;
  onGenerateVideo: (aspectRatio: AspectRatio, duration: VideoDuration, modelId: string) => void;
  onEditVideoPrompt: () => void;
  onOptimizeVideoPromptForModeration: () => void;
  onImageClick: (url: string, title: string) => void;
}

const ShotWorkbench: React.FC<ShotWorkbenchProps> = ({
  shot,
  shotIndex,
  totalShots,
  scriptData,
  nextShotHasStartFrame = false,
  isAIOptimizing = false,
  isSplittingShot = false,
  onClose,
  onPrevious,
  onNext,
  onEditActionSummary,
  onGenerateAIAction,
  onSplitShot,
  onAddCharacter,
  onRemoveCharacter,
  onVariationChange,
  onSceneChange,
  onGenerateKeyframe,
  onUploadKeyframe,
  onEditKeyframePrompt,
  onOptimizeKeyframeWithAI,
  onOptimizeBothKeyframes,
  onCopyPreviousEndFrame,
  onCopyNextStartFrame,
  useAIEnhancement,
  onToggleAIEnhancement,
  onGenerateVideo,
  onEditVideoPrompt,
  onOptimizeVideoPromptForModeration,
  onImageClick
}) => {
  const scene = scriptData?.scenes.find(s => String(s.id) === String(shot.sceneId));
  let shotCharacterIds: string[] = [];
  const chars = shot.characters as any;
  if (Array.isArray(chars)) {
    shotCharacterIds = chars;
  } else if (typeof chars === 'string' && chars.trim()) {
    shotCharacterIds = chars.split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  const activeCharacters = scriptData?.characters.filter(c => shotCharacterIds.includes(c.id)) || [];
  const availableCharacters = scriptData?.characters.filter(c => !shotCharacterIds.includes(c.id)) || [];
  
  const startKf = shot.keyframes?.find(k => k.type === 'start');
  const endKf = shot.keyframes?.find(k => k.type === 'end');
  
  // shot-1 / shot-1-1 需要映射为工作台上的主镜头/子镜头编号。
  const getShotDisplayNumber = () => {
    const idParts = shot.id.split('-').slice(1);
    if (idParts.length === 1) {
      return String(idParts[0]).padStart(2, '0');
    } else if (idParts.length === 2) {
      return `${String(idParts[0]).padStart(2, '0')}-${idParts[1]}`;
    } else {
      return String(shotIndex + 1).padStart(2, '0');
    }
  };
  
  return (
    <div className="w-[480px] bg-slate-950/80 border-l border-white/10 flex flex-col h-full shadow-2xl shadow-cyan-950/30 animate-in slide-in-from-right-10 duration-300 relative z-20 backdrop-blur-2xl">
      <div className="h-16 px-6 border-b border-white/10 flex items-center justify-between bg-white/[0.04] shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 bg-cyan-300/10 text-cyan-200 rounded-xl flex items-center justify-center font-bold font-mono text-sm border border-cyan-200/20">
            {getShotDisplayNumber()}
          </span>
          <div>
            <h3 className="text-white font-bold text-sm">镜头详情</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
              {shot.cameraMovement}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevious}
            disabled={shotIndex === 0}
            className="p-2 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNext}
            disabled={shotIndex === totalShots - 1}
            className="p-2 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-2"></div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-red-900/20 rounded text-zinc-400 hover:text-red-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {scriptData && (
          <SceneContext
            shot={shot}
            scene={scene}
            scenes={scriptData.scenes}
            characters={activeCharacters}
            availableCharacters={availableCharacters}
            onAddCharacter={onAddCharacter}
            onRemoveCharacter={onRemoveCharacter}
            onVariationChange={onVariationChange}
            onSceneChange={onSceneChange}
          />
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2">
            <Film className="w-4 h-4 text-zinc-500" />
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              叙事动作 (Action & Dialogue)
            </h4>
            <div className="ml-auto flex items-center gap-1">
              <button 
                onClick={onSplitShot}
                disabled={isSplittingShot}
                className="p-1 text-green-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="AI拆分镜头"
              >
                {isSplittingShot ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Scissors className="w-3 h-3" />
                )}
              </button>
              <button 
                onClick={onGenerateAIAction}
                disabled={isAIOptimizing}
                className="p-1 text-cyan-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="AI生成动作建议"
              >
                {isAIOptimizing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
              </button>
              <button 
                onClick={onEditActionSummary}
                className="p-1 text-yellow-400 hover:text-white transition-colors"
                title="编辑叙事动作"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          
          <div className="space-y-3 max-h-[200px] overflow-y-auto custom-scrollbar">
            <div className="bg-white/[0.045] p-4 rounded-2xl border border-white/10">
              <p className="text-zinc-200 text-sm leading-relaxed">{shot.actionSummary}</p>
            </div>
            
            {shot.dialogue && (
              <div className="bg-white/[0.045] p-4 rounded-2xl border border-white/10 flex gap-3">
                <MessageSquare className="w-4 h-4 text-zinc-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-zinc-400 text-xs italic leading-relaxed">
                    "{shot.dialogue}"
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <KeyframeEditor
          startKeyframe={startKf}
          endKeyframe={endKf}
          canCopyPrevious={shotIndex > 0}
          canCopyNext={shotIndex < totalShots - 1 && nextShotHasStartFrame}
          isAIOptimizing={isAIOptimizing}
          useAIEnhancement={useAIEnhancement}
          onToggleAIEnhancement={onToggleAIEnhancement}
          onGenerateKeyframe={onGenerateKeyframe}
          onUploadKeyframe={onUploadKeyframe}
          onEditPrompt={onEditKeyframePrompt}
          onOptimizeWithAI={onOptimizeKeyframeWithAI}
          onOptimizeBothWithAI={onOptimizeBothKeyframes}
          onCopyPrevious={onCopyPreviousEndFrame}
          onCopyNext={onCopyNextStartFrame}
          onImageClick={onImageClick}
        />

        <VideoGenerator
          shot={shot}
          hasStartFrame={!!startKf?.imageUrl}
          hasEndFrame={!!endKf?.imageUrl}
          onGenerate={onGenerateVideo}
          onEditPrompt={onEditVideoPrompt}
          onOptimizeForModeration={onOptimizeVideoPromptForModeration}
          isOptimizingForModeration={isAIOptimizing}
        />
      </div>
    </div>
  );
};

export default ShotWorkbench;

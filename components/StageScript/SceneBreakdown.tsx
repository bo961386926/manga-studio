import React from 'react';
import { Clock, List, ArrowLeft, TextQuote } from 'lucide-react';
import { ProjectState, Shot } from '../../types';
import { deduplicateScenes } from './utils';
import CharacterList from './CharacterList';
import SceneList from './SceneList';
import ShotRow from './ShotRow';

interface Props {
  project: ProjectState;
  editingCharacterId: string | null;
  editingCharacterPrompt: string;
  editingShotId: string | null;
  editingShotPrompt: string;
  editingShotCharactersId: string | null;
  editingShotActionId: string | null;
  editingShotActionText: string;
  editingShotDialogueText: string;
  onEditCharacter: (charId: string, prompt: string) => void;
  onSaveCharacter: (charId: string, prompt: string) => void;
  onCancelCharacterEdit: () => void;
  onEditShotPrompt: (shotId: string, prompt: string) => void;
  onSaveShotPrompt: () => void;
  onCancelShotPrompt: () => void;
  onEditShotCharacters: (shotId: string) => void;
  onAddCharacterToShot: (shotId: string, charId: string) => void;
  onRemoveCharacterFromShot: (shotId: string, charId: string) => void;
  onCloseShotCharactersEdit: () => void;
  onEditShotAction: (shotId: string, action: string, dialogue: string) => void;
  onSaveShotAction: () => void;
  onCancelShotAction: () => void;
  onBackToStory: () => void;
}

const SceneBreakdown: React.FC<Props> = ({
  project,
  editingCharacterId,
  editingCharacterPrompt,
  editingShotId,
  editingShotPrompt,
  editingShotCharactersId,
  editingShotActionId,
  editingShotActionText,
  editingShotDialogueText,
  onEditCharacter,
  onSaveCharacter,
  onCancelCharacterEdit,
  onEditShotPrompt,
  onSaveShotPrompt,
  onCancelShotPrompt,
  onEditShotCharacters,
  onAddCharacterToShot,
  onRemoveCharacterFromShot,
  onCloseShotCharactersEdit,
  onEditShotAction,
  onSaveShotAction,
  onCancelShotAction,
  onBackToStory
}) => {
  const uniqueScenes = deduplicateScenes(project.scriptData?.scenes);

  return (
    <div className="flex flex-col h-full bg-slate-950/35 animate-in fade-in duration-500 backdrop-blur-sm">
      <div className="h-16 px-6 border-b border-white/10 bg-slate-950/55 flex items-center justify-between shrink-0 z-20 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <h2 className="text-lg font-light text-white tracking-tight flex items-center gap-3">
            <List className="w-5 h-5 text-cyan-300" />
            拍摄清单
            <span className="text-xs text-cyan-100/40 font-mono uppercase tracking-wider ml-1">Script Manifest</span>
          </h2>
          <div className="h-6 w-px bg-white/10"></div>
          
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-cyan-100/40 uppercase tracking-widest">项目</span>
              <span className="text-sm text-zinc-200 font-medium">{project.scriptData?.title}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-cyan-100/40 uppercase tracking-widest">时长</span>
              <span className="text-sm font-mono text-cyan-100/70">{project.targetDuration}</span>
            </div>
          </div>
        </div>
        
        <button 
          onClick={onBackToStory}
          className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-xl transition-all"
        >
          <ArrowLeft className="w-3 h-3" />
          返回编辑
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="w-72 border-r border-white/10 bg-slate-950/55 flex flex-col hidden lg:flex backdrop-blur-xl">
          <div className="p-6 border-b border-white/10">
            <h3 className="text-[10px] font-bold text-cyan-100/45 uppercase tracking-widest mb-4 flex items-center gap-2">
              <TextQuote className="w-3 h-3" /> 故事梗概
            </h3>
            <p className="text-xs text-slate-300 italic leading-relaxed font-serif">"{project.scriptData?.logline}"</p>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <CharacterList
              characters={project.scriptData?.characters || []}
              editingCharacterId={editingCharacterId}
              editingPrompt={editingCharacterPrompt}
              onEdit={onEditCharacter}
              onSave={onSaveCharacter}
              onCancel={onCancelCharacterEdit}
            />

            <SceneList scenes={uniqueScenes} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-950/20 p-0">
          <div className="max-w-5xl mx-auto pb-20">
            {project.scriptData?.scenes.map((scene, index) => {
              const sceneShots = project.shots.filter(s => s.sceneId === scene.id);
              if (sceneShots.length === 0) return null;

              return (
                <div key={scene.id} className="border-b border-white/10">
                  <div className="sticky top-0 z-10 bg-slate-950/85 backdrop-blur-xl border-y border-white/10 px-8 py-5 flex items-center justify-between shadow-lg shadow-black/20">
                    <div className="flex items-baseline gap-4">
                      <span className="text-3xl font-bold text-white/10 font-mono">{(index + 1).toString().padStart(2, '0')}</span>
                      <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                        {scene.location}
                      </h3>
                    </div>
                    <div className="flex gap-4 text-[10px] font-mono uppercase tracking-widest text-cyan-100/45">
                      <span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/> {scene.time}</span>
                      <span className="text-zinc-700">|</span>
                      <span>{scene.atmosphere}</span>
                    </div>
                  </div>

                  <div className="divide-y divide-white/10">
                    {sceneShots.map((shot) => (
                      <ShotRow
                        key={shot.id}
                        shot={shot}
                        shotNumber={project.shots.indexOf(shot) + 1}
                        scriptData={project.scriptData}
                        editingShotId={editingShotId}
                        editingShotPrompt={editingShotPrompt}
                        editingShotCharactersId={editingShotCharactersId}
                        editingShotActionId={editingShotActionId}
                        editingShotActionText={editingShotActionText}
                        editingShotDialogueText={editingShotDialogueText}
                        onEditPrompt={onEditShotPrompt}
                        onSavePrompt={onSaveShotPrompt}
                        onCancelPrompt={onCancelShotPrompt}
                        onEditCharacters={onEditShotCharacters}
                        onAddCharacter={onAddCharacterToShot}
                        onRemoveCharacter={onRemoveCharacterFromShot}
                        onCloseCharactersEdit={onCloseShotCharactersEdit}
                        onEditAction={onEditShotAction}
                        onSaveAction={onSaveShotAction}
                        onCancelAction={onCancelShotAction}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneBreakdown;

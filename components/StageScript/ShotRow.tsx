import React from 'react';
import { Aperture, Edit2, Check, X, UserPlus } from 'lucide-react';
import { Shot, Character, ScriptData } from '../../types';
import InlineEditor from './InlineEditor';
import { STYLES } from './constants';

interface Props {
  shot: Shot;
  shotNumber: number;
  scriptData?: ScriptData;
  editingShotId: string | null;
  editingShotPrompt: string;
  editingShotCharactersId: string | null;
  editingShotActionId: string | null;
  editingShotActionText: string;
  editingShotDialogueText: string;
  onEditPrompt: (shotId: string, prompt: string) => void;
  onSavePrompt: () => void;
  onCancelPrompt: () => void;
  onEditCharacters: (shotId: string) => void;
  onAddCharacter: (shotId: string, charId: string) => void;
  onRemoveCharacter: (shotId: string, charId: string) => void;
  onCloseCharactersEdit: () => void;
  onEditAction: (shotId: string, action: string, dialogue: string) => void;
  onSaveAction: () => void;
  onCancelAction: () => void;
}

const ShotRow: React.FC<Props> = ({
  shot,
  shotNumber,
  scriptData,
  editingShotId,
  editingShotPrompt,
  editingShotCharactersId,
  editingShotActionId,
  editingShotActionText,
  editingShotDialogueText,
  onEditPrompt,
  onSavePrompt,
  onCancelPrompt,
  onEditCharacters,
  onAddCharacter,
  onRemoveCharacter,
  onCloseCharactersEdit,
  onEditAction,
  onSaveAction,
  onCancelAction
}) => {
  let shotCharacterIds: string[] = [];
  const chars = shot.characters as any;
  if (Array.isArray(chars)) {
    shotCharacterIds = chars;
  } else if (typeof chars === 'string' && chars.trim()) {
    shotCharacterIds = chars.split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  // shot-1 / shot-1-1 需要映射为分鏡列表上的主鏡頭/子鏡頭編號。
  const getShotDisplayNumber = () => {
    const idParts = shot.id.split('-').slice(1);
    if (idParts.length === 1) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}`;
    } else if (idParts.length === 2) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}-${idParts[1]}`;
    } else {
      return `SHOT ${shotNumber.toString().padStart(3, '0')}`;
    }
  };

  return (
    <div className="group bg-white/[0.025] hover:bg-white/[0.055] transition-colors p-8 flex gap-8">
      <div className="w-32 flex-shrink-0 flex flex-col gap-4">
        <div className="text-xs font-mono text-zinc-500 group-hover:text-white transition-colors">
          {getShotDisplayNumber()}
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="px-2 py-1 bg-cyan-300/10 border border-cyan-200/15 text-[10px] font-mono text-cyan-100/65 uppercase text-center rounded-full">
            {shot.shotSize || 'MED'}
          </div>
          <div className="px-2 py-1 bg-cyan-300/10 border border-cyan-200/15 text-[10px] font-mono text-cyan-100/65 uppercase text-center rounded-full">
            {shot.cameraMovement}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4">
        {editingShotActionId === shot.id ? (
          <div className="space-y-3 p-4 bg-slate-950/55 border border-white/10 rounded-2xl">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">动作描述</label>
              <textarea
                value={editingShotActionText}
                onChange={(e) => onEditAction(shot.id, e.target.value, editingShotDialogueText)}
                className={STYLES.editor.textarea}
                rows={3}
                placeholder="输入动作描述..."
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">台词（可选）</label>
              <textarea
                value={editingShotDialogueText}
                onChange={(e) => onEditAction(shot.id, editingShotActionText, e.target.value)}
                className={`${STYLES.editor.textarea} ${STYLES.editor.serif}`}
                rows={2}
                placeholder="输入台词（留空表示无台词）..."
              />
            </div>
            
            <div className="flex gap-2 pt-2 border-t border-white/10">
              <button onClick={onSaveAction} className="px-3 py-1.5 bg-cyan-300 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-1 hover:bg-cyan-200 transition-colors">
                <Check className="w-3 h-3" />
                保存
              </button>
              <button onClick={onCancelAction} className="px-3 py-1.5 bg-white/10 text-zinc-300 text-xs font-bold rounded-xl flex items-center gap-1 hover:bg-white/15 transition-colors">
                <X className="w-3 h-3" />
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="relative group/action">
            <div className="flex items-start gap-2">
              <p className="text-zinc-200 text-sm leading-7 font-medium max-w-2xl flex-1">
                {shot.actionSummary}
              </p>
              <button
                onClick={() => onEditAction(shot.id, shot.actionSummary, shot.dialogue || '')}
                className="opacity-0 group-hover/action:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded-xl flex-shrink-0"
                title="编辑动作和台词"
              >
                <Edit2 className="w-3.5 h-3.5 text-zinc-500 hover:text-white" />
              </button>
            </div>
            
            {shot.dialogue && (
              <div className="pl-6 border-l-2 border-cyan-200/15 group-hover:border-cyan-200/35 transition-colors py-1 mt-3">
                <p className="text-zinc-400 font-serif italic text-sm">"{shot.dialogue}"</p>
              </div>
            )}
          </div>
        )}
        
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">角色</span>
            <button
              onClick={() => onEditCharacters(shot.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded-xl"
              title="编辑角色列表"
            >
              <Edit2 className="w-3 h-3 text-zinc-500 hover:text-white" />
            </button>
          </div>
          
          {editingShotCharactersId === shot.id ? (
            <div className="space-y-3 p-3 bg-slate-950/55 border border-white/10 rounded-2xl">
              <div className="space-y-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">当前角色</div>
                <div className="flex flex-wrap gap-2">
                  {shotCharacterIds.length === 0 ? (
                    <span className="text-xs text-zinc-600 italic">无角色</span>
                  ) : (
                    shotCharacterIds.map(cid => {
                      const char = scriptData?.characters.find(c => c.id === cid);
                      return char ? (
                        <div key={cid} className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-cyan-100/75 border border-cyan-200/15 px-2 py-1 rounded-full bg-cyan-300/10">
                          <span>{char.name}</span>
                          <button
                            onClick={() => onRemoveCharacter(shot.id, cid)}
                            className="ml-1 hover:text-red-400 transition-colors"
                            title="移除角色"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : null;
                    })
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">添加角色</div>
                <div className="flex flex-wrap gap-2">
                  {scriptData?.characters
                    .filter(char => !shotCharacterIds.includes(char.id))
                    .map(char => (
                      <button
                        key={char.id}
                        onClick={() => onAddCharacter(shot.id, char.id)}
                        className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 border border-white/10 px-2 py-1 rounded-full bg-white/[0.04] hover:bg-cyan-300/10 hover:text-cyan-100 hover:border-cyan-200/25 transition-colors"
                        title="添加角色"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>{char.name}</span>
                      </button>
                    ))}
                  {scriptData?.characters.filter(char => !shotCharacterIds.includes(char.id)).length === 0 && (
                    <span className="text-xs text-zinc-600 italic">所有角色已添加</span>
                  )}
                </div>
              </div>
              
              <div className="pt-2 border-t border-white/10">
                <button
                  onClick={onCloseCharactersEdit}
                  className="px-3 py-1.5 bg-cyan-300/10 text-cyan-100 text-xs font-bold rounded-xl flex items-center gap-1 hover:bg-cyan-300/15 transition-colors border border-cyan-200/15"
                >
                  <Check className="w-3 h-3" />
                  完成
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
              {shotCharacterIds.length === 0 ? (
                <span className="text-[10px] text-zinc-700 italic">无角色</span>
              ) : (
                shotCharacterIds.map(cid => {
                  const char = scriptData?.characters.find(c => c.id === cid);
                  return char ? (
                    <span key={cid} className="text-[10px] uppercase font-bold tracking-wider text-cyan-100/55 border border-cyan-200/15 px-2 py-0.5 rounded-full bg-cyan-300/10">
                      {char.name}
                    </span>
                  ) : null;
                })
              )}
            </div>
          )}
        </div>

        <div className="xl:hidden pt-4 border-t border-white/10">
          <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2 flex items-center gap-2 justify-between">
            <span className="flex items-center gap-2">
              <Aperture className="w-3 h-3" /> 画面提示词
            </span>
            {editingShotId !== shot.id && (
              <button
                onClick={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
                className="p-1.5 bg-white/10 hover:bg-white/15 rounded-xl transition-colors"
                title="编辑提示词"
              >
                <Edit2 className="w-3 h-3 text-zinc-400" />
              </button>
            )}
          </div>
          <InlineEditor
            isEditing={editingShotId === shot.id}
            value={editingShotId === shot.id ? editingShotPrompt : shot.keyframes[0]?.visualPrompt || ''}
            onEdit={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
            onChange={(val) => onEditPrompt(shot.id, val)}
            onSave={onSavePrompt}
            onCancel={onCancelPrompt}
            placeholder="输入画面提示词..."
            rows={4}
            mono={true}
            showEditButton={false}
          />
        </div>
      </div>

      <div className="w-64 hidden xl:block pl-6 border-l border-white/10">
        <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest mb-2 flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Aperture className="w-3 h-3" /> 画面提示词
          </span>
          {editingShotId !== shot.id && (
            <button
              onClick={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded-xl"
              title="编辑提示词"
            >
              <Edit2 className="w-3 h-3 text-zinc-500 hover:text-white" />
            </button>
          )}
        </div>
        <InlineEditor
          isEditing={editingShotId === shot.id}
          value={editingShotId === shot.id ? editingShotPrompt : shot.keyframes[0]?.visualPrompt || ''}
          onEdit={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
          onChange={(val) => onEditPrompt(shot.id, val)}
          onSave={onSavePrompt}
          onCancel={onCancelPrompt}
          placeholder="输入画面提示词..."
          rows={6}
          mono={true}
          showEditButton={false}
        />
      </div>
    </div>
  );
};

export default ShotRow;

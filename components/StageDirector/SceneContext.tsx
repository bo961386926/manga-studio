import React from 'react';
import { MapPin, User, Clock, X, Shirt, Edit2 } from 'lucide-react';
import { Shot, Character, Scene } from '../../types';

interface SceneContextProps {
  shot: Shot;
  scene?: Scene;
  scenes?: Scene[];
  characters: Character[];
  availableCharacters: Character[];
  onAddCharacter: (charId: string) => void;
  onRemoveCharacter: (charId: string) => void;
  onVariationChange: (charId: string, varId: string) => void;
  onSceneChange?: (sceneId: string) => void;
}

const SceneContext: React.FC<SceneContextProps> = ({
  shot,
  scene,
  scenes = [],
  characters,
  availableCharacters,
  onAddCharacter,
  onRemoveCharacter,
  onVariationChange,
  onSceneChange
}) => {
  return (
    <div className="bg-white/[0.045] p-5 rounded-2xl border border-white/10 mb-6 space-y-4 backdrop-blur">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-4 h-4 text-zinc-500" />
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
          场景环境 (Scene Context)
        </h4>
      </div>
      
      <div className="flex gap-4">
        <div className="w-28 h-20 bg-slate-950/70 rounded-2xl overflow-hidden flex-shrink-0 border border-white/10 relative">
          {scene?.referenceImage ? (
            <img src={scene.referenceImage} className="w-full h-full object-cover" alt={scene.location} />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-white/[0.04]">
              <MapPin className="w-6 h-6 text-zinc-700" />
            </div>
          )}
        </div>
        
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {onSceneChange && scenes.length > 1 ? (
              <select
                value={shot.sceneId}
                onChange={(e) => onSceneChange(e.target.value)}
                className="flex-1 min-w-0 max-w-[180px] bg-white/[0.06] text-white text-sm font-bold border border-white/10 rounded-xl px-2 py-1 outline-none focus:border-cyan-300/40 hover:border-cyan-300/30 transition-colors truncate"
                style={{ textOverflow: 'ellipsis' }}
                title={scene?.location}
              >
                {scenes.map(s => (
                  <option key={s.id} value={s.id} title={s.location}>
                    {s.location.length > 20 ? `${s.location.slice(0, 20)}...` : s.location}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-white text-sm font-bold truncate max-w-[180px]" title={scene?.location}>
                {scene?.location || '未知场景'}
              </span>
            )}
            <span className="text-sm px-2 py-0.5 bg-cyan-300/10 text-cyan-100/65 rounded-full flex items-center gap-1 shrink-0 border border-cyan-200/15">
              <Clock className="w-3 h-3" />
              {scene?.time}
            </span>
          </div>
          <p className="text-xs text-zinc-500 line-clamp-2">{scene?.atmosphere}</p>
          
          <div className="flex flex-col gap-2 pt-2">
            {characters.map(char => {
              const hasVars = char.variations && char.variations.length > 0;
              const selectedVarId = shot.characterVariations?.[char.id];
              
              return (
                <div 
                  key={char.id} 
                  className="flex items-center justify-between bg-slate-950/45 rounded-xl p-1.5 border border-white/10 group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0">
                      {char.referenceImage && (
                        <img src={char.referenceImage} className="w-full h-full object-cover" alt={char.name} />
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-300 font-medium">{char.name}</span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    {hasVars && (
                      <select
                        value={selectedVarId || ''}
                        onChange={(e) => onVariationChange(char.id, e.target.value)}
                        className="text-[10px] bg-white/[0.06] text-zinc-400 border border-white/10 rounded-lg px-1.5 py-0.5 outline-none"
                      >
                        <option value="">基础造型</option>
                        {char.variations!.map(v => (
                          <option key={v.id} value={v.id}>
                            <Shirt className="w-2 h-2 inline mr-1" />
                            {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => onRemoveCharacter(char.id)}
                      className="p-1 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="移除角色"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            
            {availableCharacters.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <select 
                  onChange={(e) => {
                    if (e.target.value) {
                      onAddCharacter(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="flex-1 bg-white/[0.06] text-[11px] text-zinc-400 border border-white/10 rounded-xl px-2 py-1.5 outline-none focus:border-cyan-300/40 hover:border-cyan-300/30 transition-colors"
                >
                  <option value="">+ 添加角色到此镜头</option>
                  {availableCharacters.map(char => (
                    <option key={char.id} value={char.id}>{char.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneContext;

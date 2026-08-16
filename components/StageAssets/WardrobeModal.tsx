import React, { useState } from 'react';
import { User, X, Shirt, Plus, RefreshCw, Loader2, Upload, AlertCircle } from 'lucide-react';
import { Character, CharacterVariation } from '../../types';
import ImageUploadButton from './ImageUploadButton';
import { generateId } from './utils';

interface WardrobeModalProps {
  character: Character;
  onClose: () => void;
  onAddVariation: (charId: string, name: string, prompt: string) => void;
  onDeleteVariation: (charId: string, varId: string) => void;
  onGenerateVariation: (charId: string, varId: string) => void;
  onUploadVariation: (charId: string, varId: string, file: File) => void;
  onImageClick: (imageUrl: string) => void;
}

const WardrobeModal: React.FC<WardrobeModalProps> = ({
  character,
  onClose,
  onAddVariation,
  onDeleteVariation,
  onGenerateVariation,
  onUploadVariation,
  onImageClick,
}) => {
  const [newVarName, setNewVarName] = useState('');
  const [newVarPrompt, setNewVarPrompt] = useState('');

  const handleAddVariation = () => {
    if (newVarName && newVarPrompt) {
      onAddVariation(character.id, newVarName, newVarPrompt);
      setNewVarName('');
      setNewVarPrompt('');
    }
  };

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="bg-slate-950/90 border border-cyan-200/15 w-full max-w-4xl max-h-[90vh] rounded-[1.75rem] flex flex-col shadow-2xl shadow-cyan-950/30 overflow-hidden">
        <div className="h-16 px-8 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.04]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-white/10 overflow-hidden border border-white/10">
              {character.referenceImage && (
                <img src={character.referenceImage} className="w-full h-full object-cover" alt={character.name} />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{character.name}</h3>
              <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Wardrobe & Variations</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <User className="w-4 h-4" /> Base Appearance
              </h4>
              <div className="bg-white/[0.045] p-4 rounded-2xl border border-white/10 backdrop-blur">
                <div 
                  className="aspect-video bg-slate-950/70 rounded-2xl overflow-hidden mb-4 relative cursor-pointer border border-white/10"
                  onClick={() => character.referenceImage && onImageClick(character.referenceImage)}
                >
                  {character.referenceImage ? (
                    <img src={character.referenceImage} className="w-full h-full object-cover" alt="Base" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-zinc-700">No Image</div>
                  )}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur rounded text-[10px] text-white font-bold uppercase border border-white/10">
                    Default
                  </div>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed font-mono">{character.visualPrompt}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Shirt className="w-4 h-4" /> Variations / Outfits
                </h4>
              </div>

              <div className="space-y-4">
                {(character.variations || []).map((variation) => (
                  <div 
                    key={variation.id} 
                    className="flex gap-4 p-4 bg-white/[0.045] border border-white/10 rounded-2xl group hover:border-cyan-200/30 transition-colors backdrop-blur"
                  >
                    <div className="w-20 h-24 bg-slate-950/70 rounded-xl flex-shrink-0 overflow-hidden relative border border-white/10">
                      {variation.referenceImage ? (
                        <img 
                          src={variation.referenceImage} 
                          className="w-full h-full object-cover cursor-pointer" 
                          alt={variation.name}
                          onClick={() => onImageClick(variation.referenceImage!)}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {variation.status === 'failed' ? (
                            <AlertCircle className="w-6 h-6 text-red-500" />
                          ) : (
                            <Shirt className="w-6 h-6 text-zinc-800" />
                          )}
                        </div>
                      )}
                      {variation.status === 'generating' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 text-white animate-spin" />
                        </div>
                      )}
                      {variation.status === 'failed' && !variation.referenceImage && (
                        <div className="absolute bottom-0 left-0 right-0 bg-red-900/80 text-white text-[8px] text-center py-0.5">
                          失败
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="font-bold text-zinc-200 text-sm">{variation.name}</h5>
                        <button 
                          onClick={() => onDeleteVariation(character.id, variation.id)} 
                          className="text-zinc-600 hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 line-clamp-2 mb-3 font-mono">{variation.visualPrompt}</p>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => onGenerateVariation(character.id, variation.id)}
                          disabled={variation.status === 'generating'}
                          className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors disabled:opacity-50 ${
                            variation.status === 'failed' 
                              ? 'text-red-400 hover:text-red-300' 
                              : 'text-cyan-300 hover:text-white'
                          }`}
                        >
                          <RefreshCw className={`w-3 h-3 ${variation.status === 'generating' ? 'animate-spin' : ''}`} />
                          {variation.status === 'failed' ? '重试' : variation.referenceImage ? 'Regenerate' : 'Generate Look'}
                        </button>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:text-white flex items-center gap-1 transition-colors cursor-pointer">
                          <Upload className="w-3 h-3" />
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                onUploadVariation(character.id, variation.id, file);
                                e.target.value = '';
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="p-4 border border-dashed border-cyan-200/15 rounded-2xl bg-white/[0.035]">
                  <div className="space-y-3">
                    <input 
                      type="text" 
                      placeholder="Variation Name (e.g. Tactical Gear)" 
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40"
                    />
                    <textarea 
                      placeholder="Visual description of outfit/state..."
                      value={newVarPrompt}
                      onChange={(e) => setNewVarPrompt(e.target.value)}
                      className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40 resize-none h-16"
                    />
                    <button 
                      onClick={handleAddVariation}
                      disabled={!newVarName || !newVarPrompt}
                      className="w-full py-2 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add Variation
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WardrobeModal;

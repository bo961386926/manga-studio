import React, { useState } from 'react';
import { User, Check, Sparkles, Loader2, Shirt, Trash2, Edit2, AlertCircle, FolderPlus } from 'lucide-react';
import { Character } from '../../types';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';

interface CharacterCardProps {
  character: Character;
  isGenerating: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPromptSave: (newPrompt: string) => void;
  onOpenWardrobe: () => void;
  onImageClick: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { name?: string; gender?: string; age?: string; personality?: string }) => void;
  onAddToLibrary: () => void;
  onReplaceFromLibrary: () => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  isGenerating,
  onGenerate,
  onUpload,
  onPromptSave,
  onOpenWardrobe,
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
  onReplaceFromLibrary,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingGender, setIsEditingGender] = useState(false);
  const [isEditingAge, setIsEditingAge] = useState(false);
  const [editName, setEditName] = useState(character.name);
  const [editGender, setEditGender] = useState(character.gender);
  const [editAge, setEditAge] = useState(character.age);

  const handleSaveName = () => {
    if (editName.trim()) {
      onUpdateInfo({ name: editName.trim() });
      setIsEditingName(false);
    }
  };

  const handleSaveGender = () => {
    if (editGender.trim()) {
      onUpdateInfo({ gender: editGender.trim() });
      setIsEditingGender(false);
    }
  };

  const handleSaveAge = () => {
    if (editAge.trim()) {
      onUpdateInfo({ age: editAge.trim() });
      setIsEditingAge(false);
    }
  };

  return (
    <div className="bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden flex flex-col group hover:border-cyan-200/35 transition-all hover:shadow-xl hover:shadow-cyan-950/20 backdrop-blur">
      <div className="flex gap-4 p-4 pb-0">
        <div className="w-48 flex-shrink-0">
          <div 
            className="aspect-video bg-slate-950/70 relative rounded-2xl overflow-hidden cursor-pointer border border-white/10"
            onClick={() => character.referenceImage && onImageClick(character.referenceImage)}
          >
            {character.referenceImage ? (
              <>
                <img src={character.referenceImage} alt={character.name} className="w-full h-full object-cover" />
                <div className="absolute top-1.5 right-1.5 p-1 bg-cyan-300 text-slate-950 rounded-lg shadow-lg shadow-cyan-500/20">
                  <Check className="w-3 h-3" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 p-2 text-center">
                {character.status === 'failed' ? (
                  <>
                    <AlertCircle className="w-8 h-8 mb-2 text-red-500" />
                    <span className="text-[10px] text-red-500 mb-2">生成失败</span>
                    <ImageUploadButton
                      variant="inline"
                      size="small"
                      onUpload={onUpload}
                      onGenerate={onGenerate}
                      isGenerating={isGenerating}
                      uploadLabel="上传"
                      generateLabel="重试"
                    />
                  </>
                ) : (
                  <>
                    <User className="w-8 h-8 mb-2 opacity-10" />
                    <ImageUploadButton
                      variant="inline"
                      size="small"
                      onUpload={onUpload}
                      onGenerate={onGenerate}
                      isGenerating={isGenerating}
                      uploadLabel="上传"
                      generateLabel="生成"
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 justify-between">
          <div>
            {isEditingName ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSaveName}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveName()}
                autoFocus
                className="font-bold text-white text-base mb-1 bg-white/[0.06] border border-white/10 rounded-xl px-2 py-1 w-full focus:outline-none focus:border-cyan-300/40"
              />
            ) : (
              <div className="flex items-center gap-2 mb-1 group/name">
                <h3 className="font-bold text-white text-base">{character.name}</h3>
                <button
                  onClick={() => {
                    setEditName(character.name);
                    setIsEditingName(true);
                  }}
                  className="opacity-0 group-hover/name:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              {isEditingGender ? (
                <input
                  type="text"
                  value={editGender}
                  onChange={(e) => setEditGender(e.target.value)}
                  onBlur={handleSaveGender}
                  onKeyPress={(e) => e.key === 'Enter' && handleSaveGender()}
                  autoFocus
                  className="text-[10px] text-white font-mono uppercase bg-white/[0.06] border border-white/10 px-2 py-0.5 rounded-lg focus:outline-none focus:border-cyan-300/40 w-20"
                />
              ) : (
                <span
                  onClick={() => {
                    setEditGender(character.gender);
                    setIsEditingGender(true);
                  }}
                  className="text-[10px] text-cyan-100/55 font-mono uppercase bg-cyan-300/10 px-2 py-0.5 rounded-full cursor-pointer hover:bg-cyan-300/15 hover:text-cyan-100 transition-colors"
                >
                  {character.gender}
                </span>
              )}
              {isEditingAge ? (
                <input
                  type="text"
                  value={editAge}
                  onChange={(e) => setEditAge(e.target.value)}
                  onBlur={handleSaveAge}
                  onKeyPress={(e) => e.key === 'Enter' && handleSaveAge()}
                  autoFocus
                  className="text-[10px] text-white bg-white/[0.06] border border-white/10 px-2 py-0.5 rounded-lg focus:outline-none focus:border-cyan-300/40 w-20"
                />
              ) : (
                <span
                  onClick={() => {
                    setEditAge(character.age);
                    setIsEditingAge(true);
                  }}
                  className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors"
                >
                  {character.age}
                </span>
              )}
              {character.variations && character.variations.length > 0 && (
                <span className="text-[9px] text-cyan-100/60 font-mono flex items-center gap-1 bg-cyan-300/10 px-1.5 py-0.5 rounded-full border border-cyan-200/10">
                  <Shirt className="w-2.5 h-2.5" /> +{character.variations.length}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <button 
              onClick={onOpenWardrobe}
              className="w-full py-1.5 bg-white/[0.06] hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-white/10 hover:border-cyan-300/30 transition-colors"
            >
              <Shirt className="w-3 h-3" />
              服装变体
            </button>

            {character.referenceImage && (
              <div className="w-full">
                <ImageUploadButton
                  variant="separate"
                  hasImage={true}
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel="上传"
                />
              </div>
            )}

            <button
              onClick={onReplaceFromLibrary}
              disabled={isGenerating}
              className="w-full py-1.5 bg-white/[0.06] hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-white/10 hover:border-cyan-300/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <FolderPlus className="w-3 h-3" />
              从资产库替换
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex-1 mb-3">
          <PromptEditor
            prompt={character.visualPrompt || ''}
            onSave={onPromptSave}
            label="角色提示词"
            placeholder="输入角色的视觉描述..."
          />
        </div>

        <button
          onClick={onGenerate}
          disabled={isGenerating || !character.visualPrompt}
          className="w-full py-2 bg-gradient-to-r from-cyan-300 to-sky-400 hover:from-cyan-200 hover:to-sky-300 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {character.referenceImage ? '重新生成图片' : '生成角色图片'}
            </>
          )}
        </button>

        <button
          onClick={onAddToLibrary}
          disabled={isGenerating}
          className="w-full py-2 mt-2 bg-white/[0.06] hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 hover:border-cyan-300/30 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <FolderPlus className="w-3 h-3" />
          加入资产库
        </button>

        <button
          onClick={onDelete}
          disabled={isGenerating}
          className="w-full py-2 mt-2 bg-transparent hover:bg-red-950/10 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3 h-3" />
          删除角色
        </button>
      </div>
    </div>
  );
};

export default CharacterCard;

import React, { useState } from 'react';
import { MapPin, Check, Sparkles, Loader2, Upload, Trash2, Edit2, AlertCircle, FolderPlus } from 'lucide-react';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';

interface SceneCardProps {
  scene: {
    id: string;
    location: string;
    time: string;
    atmosphere: string;
    visualPrompt?: string;
    referenceImage?: string;
    status?: 'pending' | 'generating' | 'completed' | 'failed';
  };
  isGenerating: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPromptSave: (newPrompt: string) => void;
  onImageClick: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { location?: string; time?: string; atmosphere?: string }) => void;
  onAddToLibrary: () => void;
}

const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  isGenerating,
  onGenerate,
  onUpload,
  onPromptSave,
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
}) => {
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isEditingAtmosphere, setIsEditingAtmosphere] = useState(false);
  const [editLocation, setEditLocation] = useState(scene.location);
  const [editTime, setEditTime] = useState(scene.time);
  const [editAtmosphere, setEditAtmosphere] = useState(scene.atmosphere);

  const handleSaveLocation = () => {
    if (editLocation.trim()) {
      onUpdateInfo({ location: editLocation.trim() });
      setIsEditingLocation(false);
    }
  };

  const handleSaveTime = () => {
    if (editTime.trim()) {
      onUpdateInfo({ time: editTime.trim() });
      setIsEditingTime(false);
    }
  };

  const handleSaveAtmosphere = () => {
    if (editAtmosphere.trim()) {
      onUpdateInfo({ atmosphere: editAtmosphere.trim() });
      setIsEditingAtmosphere(false);
    }
  };

  return (
    <div className="bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden flex flex-col group hover:border-cyan-200/35 transition-all hover:shadow-xl hover:shadow-cyan-950/20 backdrop-blur">
      <div 
        className="aspect-video bg-slate-950/70 relative cursor-pointer"
        onClick={() => scene.referenceImage && onImageClick(scene.referenceImage)}
      >
        {scene.referenceImage ? (
          <>
            <img src={scene.referenceImage} alt={scene.location} className="w-full h-full object-cover" />
            <div className="absolute top-2 right-2 p-1 bg-cyan-300 text-slate-950 rounded-lg shadow-lg shadow-cyan-500/20 backdrop-blur">
              <Check className="w-3 h-3" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 p-4 text-center">
            {isGenerating ? (
              <>
                <Loader2 className="w-10 h-10 mb-3 animate-spin text-cyan-300" />
                <span className="text-[10px] text-zinc-500">生成中...</span>
              </>
            ) : scene.status === 'failed' ? (
              <>
                <AlertCircle className="w-10 h-10 mb-3 text-red-500" />
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
                <MapPin className="w-10 h-10 mb-3 opacity-10" />
                <ImageUploadButton
                  variant="inline"
                  size="medium"
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
      
      <div className="p-3 border-t border-white/10 bg-slate-950/35">
        <div className="flex justify-between items-center mb-1">
          {isEditingLocation ? (
            <input
              type="text"
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              onBlur={handleSaveLocation}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveLocation()}
              autoFocus
              className="font-bold text-zinc-200 text-sm bg-white/[0.06] border border-white/10 rounded-xl px-2 py-1 flex-1 mr-2 focus:outline-none focus:border-cyan-300/40"
            />
          ) : (
            <div className="flex items-center gap-2 flex-1 group/location">
              <h3 className="font-bold text-zinc-200 text-sm truncate">{scene.location}</h3>
              <button
                onClick={() => {
                  setEditLocation(scene.location);
                  setIsEditingLocation(true);
                }}
                className="opacity-0 group-hover/location:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity flex-shrink-0"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
          {isEditingTime ? (
            <input
              type="text"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              onBlur={handleSaveTime}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveTime()}
              autoFocus
              className="px-1.5 py-0.5 bg-white/[0.06] border border-white/10 text-zinc-300 text-[9px] rounded-lg uppercase font-mono focus:outline-none focus:border-cyan-300/40 w-24"
            />
          ) : (
            <span
              onClick={() => {
                setEditTime(scene.time);
                setIsEditingTime(true);
              }}
              className="px-1.5 py-0.5 bg-cyan-300/10 text-cyan-100/55 text-[9px] rounded-full border border-cyan-200/10 uppercase font-mono cursor-pointer hover:bg-cyan-300/15 hover:text-cyan-100 transition-colors"
            >
              {scene.time}
            </span>
          )}
        </div>
        {isEditingAtmosphere ? (
          <input
            type="text"
            value={editAtmosphere}
            onChange={(e) => setEditAtmosphere(e.target.value)}
            onBlur={handleSaveAtmosphere}
            onKeyPress={(e) => e.key === 'Enter' && handleSaveAtmosphere()}
            autoFocus
            className="text-[10px] text-zinc-300 w-full bg-white/[0.06] border border-white/10 rounded-xl px-2 py-1 mb-3 focus:outline-none focus:border-cyan-300/40"
          />
        ) : (
          <p
            onClick={() => {
              setEditAtmosphere(scene.atmosphere);
              setIsEditingAtmosphere(true);
            }}
            className="text-[10px] text-zinc-500 line-clamp-1 mb-3 cursor-pointer hover:text-zinc-300 transition-colors"
          >
            {scene.atmosphere}
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-white/10">
          <PromptEditor
            prompt={scene.visualPrompt || ''}
            onSave={onPromptSave}
            label="场景提示词"
            placeholder="输入场景视觉描述..."
            maxHeight="max-h-[120px]"
          />
        </div>

        {scene.referenceImage && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <ImageUploadButton
              variant="separate"
              hasImage={true}
              onUpload={onUpload}
              onGenerate={onGenerate}
              isGenerating={isGenerating}
              uploadLabel="上传图片"
            />
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onAddToLibrary}
            disabled={isGenerating}
            className="w-full py-2 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 hover:border-cyan-300/30 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FolderPlus className="w-3 h-3" />
            加入资产库
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onDelete}
            disabled={isGenerating}
            className="w-full py-2 bg-transparent hover:bg-red-950/10 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
            删除场景
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneCard;

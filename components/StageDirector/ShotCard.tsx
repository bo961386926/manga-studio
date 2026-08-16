import React from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';
import { Shot } from '../../types';

interface ShotCardProps {
  shot: Shot;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

const ShotCard: React.FC<ShotCardProps> = ({ shot, index, isActive, onClick }) => {
  const sKf = shot.keyframes?.find(k => k.type === 'start');
  const hasImage = !!sKf?.imageUrl;
  const hasVideo = !!shot.interval?.videoUrl;

  // shot-1 / shot-1-1 需要映射为卡片上的主镜头/子镜头编号。
  const getShotDisplayNumber = () => {
    const idParts = shot.id.split('-').slice(1);
    if (idParts.length === 1) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}`;
    } else if (idParts.length === 2) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}-${idParts[1]}`;
    } else {
      return `SHOT ${String(index + 1).padStart(3, '0')}`;
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`
        group relative flex flex-col bg-white/[0.045] border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 backdrop-blur
        ${isActive ? 'border-cyan-300/60 ring-1 ring-cyan-300/35 shadow-xl shadow-cyan-950/25 scale-[0.98]' : 'border-white/10 hover:border-cyan-200/35 hover:shadow-lg hover:shadow-cyan-950/15'}
      `}
    >
      <div className="px-3 py-2 bg-slate-950/45 border-b border-white/10 flex justify-between items-center">
        <span className={`font-mono text-[10px] font-bold ${isActive ? 'text-cyan-200' : 'text-slate-500'}`}>
          {getShotDisplayNumber()}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 bg-cyan-300/10 text-cyan-100/60 rounded-full uppercase">
          {shot.cameraMovement}
        </span>
      </div>

      <div className="aspect-video bg-slate-950/70 relative overflow-hidden">
        {hasImage ? (
          <img 
            src={sKf!.imageUrl} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
            alt={`Shot ${index + 1}`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-800">
            <ImageIcon className="w-8 h-8 opacity-20" />
          </div>
        )}
        
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {hasVideo && (
            <div className="px-2 py-1 bg-green-500 text-white rounded-full text-[9px] font-bold uppercase flex items-center gap-1 shadow-lg">
              <Video className="w-2.5 h-2.5" />
              VIDEO
            </div>
          )}
        </div>

        {!isActive && !hasImage && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-xs font-mono">点击编辑</span>
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
          {shot.actionSummary}
        </p>
      </div>
    </div>
  );
};

export default ShotCard;

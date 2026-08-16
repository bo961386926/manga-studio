import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, X } from 'lucide-react';
import { Shot, ProjectState } from '../../types';
import { STYLES } from './constants';
import { base64ToBlobUrl } from '../../services/videoUtils';

interface Props {
  completedShots: Shot[];
  currentShotIndex: number;
  isPlaying: boolean;
  project: ProjectState;
  onClose: () => void;
  onPlayPause: () => void;
  onPrevShot: () => void;
  onNextShot: () => void;
  onShotChange: (index: number) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

const VideoPlayerModal: React.FC<Props> = ({
  completedShots,
  currentShotIndex,
  isPlaying,
  project,
  onClose,
  onPlayPause,
  onPrevShot,
  onNextShot,
  onShotChange,
  videoRef
}) => {
  const currentShot = completedShots[currentShotIndex];
  const shotOriginalIndex = project.shots.findIndex(s => s.id === currentShot.id);

  const [videoBlobUrl, setVideoBlobUrl] = useState<string>('');

  useEffect(() => {
    const videoUrl = currentShot.interval?.videoUrl;
    if (videoUrl) {
      if (videoUrl.startsWith('data:')) {
        const blobUrl = base64ToBlobUrl(videoUrl);
        setVideoBlobUrl(blobUrl);
        return () => {
          URL.revokeObjectURL(blobUrl);
        };
      } else {
        setVideoBlobUrl(videoUrl);
      }
    } else {
      setVideoBlobUrl('');
    }
  }, [currentShot.id, currentShot.interval?.videoUrl]);

  return (
    <div className={STYLES.videoModal.overlay}>
      <div className={STYLES.videoModal.container}>
        <div className="p-4 border-b border-white/10 bg-white/[0.04] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Play className="w-5 h-5 text-cyan-300" />
            <h3 className="text-lg font-bold text-white">视频预览</h3>
            <span className="px-2 py-0.5 bg-cyan-300/10 border border-cyan-200/15 text-cyan-100/65 text-[10px] rounded-full uppercase font-mono tracking-wider">
              Shot {shotOriginalIndex + 1} / {project.shots.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={STYLES.videoModal.player} style={{ height: '60vh' }}>
          <video
            ref={videoRef}
            key={currentShot.id}
            src={videoBlobUrl}
            className="max-w-full max-h-full object-contain"
            autoPlay
            controls={false}
            playsInline
            onEnded={() => {
              if (currentShotIndex < completedShots.length - 1) {
                onShotChange(currentShotIndex + 1);
              }
            }}
          />
          
          <button
            onClick={onPlayPause}
            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group"
          >
            {!isPlaying && (
              <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Play className="w-10 h-10 text-white ml-1" />
              </div>
            )}
          </button>
        </div>

        <div className="p-4 border-t border-white/10 bg-white/[0.04]">
          <p className="text-sm text-zinc-300 mb-2 line-clamp-2">{currentShot.actionSummary}</p>
          {currentShot.dialogue && (
            <p className="text-xs text-cyan-300 italic">"{currentShot.dialogue}"</p>
          )}
        </div>

        <div className={STYLES.videoModal.controls}>
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevShot}
              disabled={currentShotIndex === 0}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
            >
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={onPlayPause}
              className="w-12 h-10 rounded-xl bg-cyan-300 hover:bg-cyan-200 text-slate-950 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <button
              onClick={onNextShot}
              disabled={currentShotIndex === completedShots.length - 1}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-mono">
              {currentShotIndex + 1} / {completedShots.length}
            </span>
            <div className="w-px h-4 bg-zinc-700"></div>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              {currentShot.cameraMovement}
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerModal;

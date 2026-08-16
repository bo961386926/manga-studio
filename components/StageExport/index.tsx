// Author: forsearch | Updated: 2026-04-30
import React, { useState, useRef, useEffect } from 'react';
import { Film } from 'lucide-react';
import { ProjectState } from '../../types';
import { downloadMasterVideo, downloadSourceAssets } from '../../services/exportService';
import { STYLES } from './constants';
import {
  calculateEstimatedDuration,
  calculateProgress,
  getCompletedShots,
  collectRenderLogs,
  hasDownloadableAssets
} from './utils';
import StatusPanel from './StatusPanel';
import TimelineVisualizer from './TimelineVisualizer';
import ActionButtons from './ActionButtons';
import SecondaryOptions from './SecondaryOptions';
import VideoPlayerModal from './VideoPlayerModal';
import RenderLogsModal from './RenderLogsModal';
import { useAlert } from '../GlobalAlert';

interface Props {
  project: ProjectState;
}

const StageExport: React.FC<Props> = ({ project }) => {
  const { showAlert } = useAlert();
  const completedShots = getCompletedShots(project);
  const progress = calculateProgress(project);
  const estimatedDuration = calculateEstimatedDuration(project);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [isDownloadingAssets, setIsDownloadingAssets] = useState(false);
  const [assetsPhase, setAssetsPhase] = useState('');
  const [assetsProgress, setAssetsProgress] = useState(0);

  const [showLogsModal, setShowLogsModal] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && showVideoPlayer) {
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch(err => {
            console.warn('Auto-play failed:', err);
            setIsPlaying(false);
          });
      }
    }
  }, [currentShotIndex, showVideoPlayer]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const handlePrevShot = () => {
    if (currentShotIndex > 0) {
      setCurrentShotIndex(prev => prev - 1);
    }
  };

  const handleNextShot = () => {
    if (currentShotIndex < completedShots.length - 1) {
      setCurrentShotIndex(prev => prev + 1);
    }
  };

  const openVideoPlayer = () => {
    if (completedShots.length > 0) {
      setCurrentShotIndex(0);
      setShowVideoPlayer(true);
      setIsPlaying(true);
    }
  };

  const closeVideoPlayer = () => {
    setShowVideoPlayer(false);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  const handleDownloadMaster = async () => {
    if (isDownloading || progress < 100) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      await downloadMasterVideo(project, (phase, prog) => {
        setDownloadPhase(phase);
        setDownloadProgress(prog);
      });
      
      setTimeout(() => {
        setIsDownloading(false);
        setDownloadPhase('');
        setDownloadProgress(0);
      }, 2000);
    } catch (error) {
      console.error('Download failed:', error);
      showAlert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
      setIsDownloading(false);
      setDownloadPhase('');
      setDownloadProgress(0);
    }
  };

  const handleDownloadAssets = async () => {
    if (isDownloadingAssets) return;
    
    if (!hasDownloadableAssets(project)) {
      showAlert('没有可下载的资源。请先生成角色、场景或镜头素材。', { type: 'warning' });
      return;
    }
    
    setIsDownloadingAssets(true);
    setAssetsProgress(0);
    
    try {
      await downloadSourceAssets(project, (phase, prog) => {
        setAssetsPhase(phase);
        setAssetsProgress(prog);
      });
      
      setTimeout(() => {
        setIsDownloadingAssets(false);
        setAssetsPhase('');
        setAssetsProgress(0);
      }, 2000);
    } catch (error) {
      console.error('Assets download failed:', error);
      showAlert(`下载源资源失败: ${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
      setIsDownloadingAssets(false);
      setAssetsPhase('');
      setAssetsProgress(0);
    }
  };

  return (
    <div className={STYLES.container}>
      <div className={STYLES.header.container}>
        <div className="flex items-center gap-4">
          <h2 className={STYLES.header.title}>
            <Film className="w-5 h-5 text-cyan-300" />
            制片导出
            <span className={STYLES.header.subtitle}>Rendering & Export</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={STYLES.header.status}>
            Status: {progress === 100 ? 'READY' : 'IN PROGRESS'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 md:p-12">
        <div className="max-w-6xl mx-auto space-y-8">
          
          <div>
            <StatusPanel 
              project={project}
              progress={progress}
              estimatedDuration={estimatedDuration}
            />
            
            <TimelineVisualizer shots={project.shots} />
            
            <ActionButtons
              completedShotsCount={completedShots.length}
              totalShots={project.shots.length}
              progress={progress}
              downloadState={{
                isDownloading,
                phase: downloadPhase,
                progress: downloadProgress
              }}
              onPreview={openVideoPlayer}
              onDownloadMaster={handleDownloadMaster}
            />
          </div>

          <SecondaryOptions
            assetsDownloadState={{
              isDownloading: isDownloadingAssets,
              phase: assetsPhase,
              progress: assetsProgress
            }}
            onDownloadAssets={handleDownloadAssets}
            onShowLogs={() => setShowLogsModal(true)}
          />

        </div>
      </div>

      {showVideoPlayer && completedShots.length > 0 && (
        <VideoPlayerModal
          completedShots={completedShots}
          currentShotIndex={currentShotIndex}
          isPlaying={isPlaying}
          project={project}
          onClose={closeVideoPlayer}
          onPlayPause={handlePlayPause}
          onPrevShot={handlePrevShot}
          onNextShot={handleNextShot}
          onShotChange={setCurrentShotIndex}
          videoRef={videoRef}
        />
      )}

      {showLogsModal && (
        <RenderLogsModal
          logs={collectRenderLogs(project)}
          expandedLogId={expandedLogId}
          onClose={() => setShowLogsModal(false)}
          onToggleExpand={(logId) => setExpandedLogId(expandedLogId === logId ? null : logId)}
        />
      )}
    </div>
  );
};

export default StageExport;

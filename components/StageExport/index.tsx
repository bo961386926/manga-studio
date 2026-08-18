// Author: forsearch | Updated: 2026-04-30
import React, { useState, useRef, useEffect } from 'react';
import { Film } from 'lucide-react';
import { ProjectState } from '../../types';
import { downloadMasterVideo, downloadSourceAssets } from '../../services/exportService';
import { mergeShotsToSingleMp4 } from '../../services/videoMerger';
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

  const [isMerging, setIsMerging] = useState(false);
  const [mergePhase, setMergePhase] = useState('');
  const [mergeProgress, setMergeProgress] = useState(0);

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
    if (isDownloading) return;
    if (completedShots.length === 0) {
      showAlert('还没有已渲染的视频片段，请先生成镜头视频。', { type: 'warning' });
      return;
    }

    // 部分导出提示:未全部渲染完成时告知用户导出的是已完成片段
    if (progress < 100) {
      showAlert(`当前已完成 ${completedShots.length}/${project.shots.length} 个镜头，将导出已渲染的部分。`, { type: 'info', title: '部分导出' });
    }

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

  const handleMergeToMp4 = async () => {
    if (isMerging || completedShots.length === 0) return;
    setIsMerging(true);
    setMergeProgress(0);
    try {
      await mergeShotsToSingleMp4(
        project.shots,
        project.scriptData?.title || project.title,
        (phase, prog) => {
          setMergePhase(phase);
          setMergeProgress(prog);
        }
      );
      setTimeout(() => {
        setIsMerging(false);
        setMergePhase('');
        setMergeProgress(0);
      }, 2000);
    } catch (error) {
      console.error('合并失败:', error);
      showAlert(`合并失败: ${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
      setIsMerging(false);
      setMergePhase('');
      setMergeProgress(0);
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

            {/* 合并为单个 MP4（ffmpeg.wasm 浏览器端合并） */}
            <div className="mt-4 p-4 bg-white/[0.025] border border-white/10 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-white">合并为单个 MP4</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    把已渲染的 {completedShots.length} 个片段合并成一个长视频
                  </div>
                </div>
                <button
                  onClick={handleMergeToMp4}
                  disabled={completedShots.length === 0 || isMerging}
                  className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all ${
                    completedShots.length === 0 || isMerging
                      ? 'bg-white/[0.05] text-slate-500 cursor-not-allowed border border-white/10'
                      : 'bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 hover:from-emerald-300 hover:to-teal-400 shadow-lg shadow-emerald-500/20'
                  }`}
                >
                  {isMerging ? '合并中...' : '合并导出 MP4'}
                </button>
              </div>
              {isMerging && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                    <span>{mergePhase}</span>
                    <span>{mergeProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-300"
                      style={{ width: `${mergeProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
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

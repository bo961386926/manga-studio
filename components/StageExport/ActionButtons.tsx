import React from 'react';
import { Play, Download, Loader2 } from 'lucide-react';
import { STYLES, DownloadState } from './constants';

interface Props {
  completedShotsCount: number;
  totalShots: number;
  progress: number;
  downloadState: DownloadState;
  onPreview: () => void;
  onDownloadMaster: () => void;
}

const ActionButtons: React.FC<Props> = ({
  completedShotsCount,
  totalShots,
  progress,
  downloadState,
  onPreview,
  onDownloadMaster
}) => {
  const { isDownloading, phase, progress: downloadProgress } = downloadState;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <button 
        onClick={onPreview}
        disabled={completedShotsCount === 0}
        className={completedShotsCount > 0 ? STYLES.button.primary : STYLES.button.disabled}
      >
        <Play className="w-4 h-4" />
        Preview Video ({completedShotsCount}/{totalShots})
      </button>

      <button 
        onClick={onDownloadMaster}
        disabled={completedShotsCount === 0 || isDownloading} 
        className={
          isDownloading
            ? STYLES.button.loading
            : completedShotsCount > 0 
            ? STYLES.button.secondary
            : STYLES.button.disabled
        }
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {isDownloading ? `${phase} ${downloadProgress}%` : `Download Master (${completedShotsCount}/${totalShots})`}
      </button>
    </div>
  );
};

export default ActionButtons;

import React from 'react';
import { Layers, Share2, Clock, Loader2 } from 'lucide-react';
import { STYLES, DownloadState } from './constants';

interface Props {
  assetsDownloadState: DownloadState;
  onDownloadAssets: () => void;
  onShowLogs: () => void;
}

const SecondaryOptions: React.FC<Props> = ({
  assetsDownloadState,
  onDownloadAssets,
  onShowLogs
}) => {
  const { isDownloading, phase, progress } = assetsDownloadState;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div 
        onClick={onDownloadAssets}
        className={isDownloading ? STYLES.card.active : STYLES.card.base}
      >
        {isDownloading && (
          <div className={STYLES.card.loading}>
            <Loader2 className="w-6 h-6 text-cyan-300 animate-spin mb-2" />
            <p className="text-xs text-white font-mono">{phase}</p>
            <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
        <Layers className={`w-5 h-5 mb-4 transition-colors ${
          isDownloading ? 'text-cyan-300' : 'text-slate-600 group-hover:text-cyan-300'
        }`} />
        <div>
          <h4 className="text-sm font-bold text-white mb-1">Source Assets</h4>
          <p className="text-[10px] text-zinc-500">Download all generated images and raw video clips.</p>
        </div>
      </div>

      <div className={STYLES.card.base}>
        <Share2 className="w-5 h-5 text-slate-600 group-hover:text-cyan-300 mb-4 transition-colors" />
        <div>
          <h4 className="text-sm font-bold text-white mb-1">Share Project</h4>
          <p className="text-[10px] text-zinc-500">Create a view-only link for client review.</p>
        </div>
      </div>

      <div 
        onClick={onShowLogs}
        className={STYLES.card.base}
      >
        <Clock className="w-5 h-5 text-slate-600 group-hover:text-cyan-300 mb-4 transition-colors" />
        <div>
          <h4 className="text-sm font-bold text-white mb-1">Render Logs</h4>
          <p className="text-[10px] text-zinc-500">View generation history and status.</p>
        </div>
      </div>
    </div>
  );
};

export default SecondaryOptions;

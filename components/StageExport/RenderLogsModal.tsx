import React from 'react';
import { Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { RenderLog } from '../../types';
import { STYLES } from './constants';
import { 
  formatTimestamp, 
  formatDuration, 
  getLogStats, 
  getLogTypeIcon, 
  getStatusColorClass,
  hasLogDetails 
} from './utils';

interface Props {
  logs: RenderLog[];
  expandedLogId: string | null;
  onClose: () => void;
  onToggleExpand: (logId: string) => void;
}

const RenderLogsModal: React.FC<Props> = ({
  logs,
  expandedLogId,
  onClose,
  onToggleExpand
}) => {
  const stats = getLogStats(logs);

  return (
    <div className={STYLES.modal.overlay}>
      <div className={STYLES.modal.container}>
        <div className={STYLES.modal.header}>
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-cyan-300" />
            <h3 className="text-xl font-bold text-white">Render Logs</h3>
            <span className="px-2 py-0.5 bg-cyan-300/10 border border-cyan-200/15 text-cyan-100/65 text-[10px] rounded-full uppercase font-mono tracking-wider">
              {logs.length} Events
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className={STYLES.statsPanel.container}>
          <div className={STYLES.statsPanel.grid}>
            <div className={STYLES.statsPanel.card}>
              <div className={STYLES.statsPanel.label}>Total Events</div>
              <div className="text-2xl font-mono font-bold text-white">{stats.total}</div>
            </div>
            <div className={STYLES.statsPanel.card}>
              <div className={STYLES.statsPanel.label}>Completed</div>
              <div className="text-2xl font-mono font-bold text-green-400">{stats.success}</div>
            </div>
            <div className={STYLES.statsPanel.card}>
              <div className={STYLES.statsPanel.label}>Failed</div>
              <div className="text-2xl font-mono font-bold text-red-400">{stats.failed}</div>
            </div>
          </div>
        </div>

        <div className={STYLES.modal.content}>
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
              <Clock className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-sm font-mono uppercase tracking-widest">No generation history available</p>
            </div>
          ) : (
            logs.map((log) => {
              const statusColor = getStatusColorClass(log.status);
              const typeIcon = getLogTypeIcon(log.type);
              const isExpanded = expandedLogId === log.id;
              const hasDetails = hasLogDetails(log);
              
              return (
                <div key={log.id} className={STYLES.logItem.container}>
                  <div 
                    className={STYLES.logItem.header}
                    onClick={() => onToggleExpand(log.id)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl mt-0.5">{typeIcon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-bold text-white">{log.resourceName}</h4>
                          <span className={`px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded border ${statusColor}`}>
                            {log.status}
                          </span>
                          {log.duration && (
                            <span className="px-1.5 py-0.5 text-[9px] font-mono text-cyan-100/55 bg-cyan-300/10 rounded-full border border-cyan-200/15">
                              {formatDuration(log.duration)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                          <span className="font-mono">{formatTimestamp(log.timestamp)}</span>
                          <span className="text-zinc-700">|</span>
                          <span className="uppercase tracking-wider">{log.model}</span>
                          <span className="text-zinc-700">|</span>
                          <span className="uppercase tracking-wider text-zinc-600">{log.type}</span>
                        </div>
                        {log.error && (
                          <div className="mt-2 p-2 bg-red-500/5 border border-red-500/20 rounded text-[10px] text-red-400">
                            {log.error}
                          </div>
                        )}
                      </div>
                      {hasDetails && (
                        <button className="mt-1 text-zinc-600 hover:text-white transition-colors">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {isExpanded && hasDetails && (
                    <div className={STYLES.logItem.details}>
                      {log.resourceId && (
                        <div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mb-1">Resource ID</div>
                          <div className="text-[10px] text-zinc-400 font-mono bg-black/30 px-2 py-1 rounded">
                            {log.resourceId}
                          </div>
                        </div>
                      )}
                      
                      {log.prompt && (
                        <div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mb-1">Prompt</div>
                          <div className="text-[10px] text-zinc-300 bg-black/30 px-3 py-2 rounded max-h-32 overflow-y-auto">
                            {log.prompt}
                          </div>
                        </div>
                      )}
                      
                      {(log.inputTokens || log.outputTokens || log.totalTokens) && (
                        <div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mb-1">Token Usage</div>
                          <div className="flex gap-4 text-[10px]">
                            {log.inputTokens && (
                              <div className="bg-black/30 px-2 py-1 rounded">
                                <span className="text-zinc-500">Input:</span>
                                <span className="text-cyan-300 font-mono ml-1">{log.inputTokens}</span>
                              </div>
                            )}
                            {log.outputTokens && (
                              <div className="bg-black/30 px-2 py-1 rounded">
                                <span className="text-zinc-500">Output:</span>
                                <span className="text-cyan-300 font-mono ml-1">{log.outputTokens}</span>
                              </div>
                            )}
                            {log.totalTokens && (
                              <div className="bg-black/30 px-2 py-1 rounded">
                                <span className="text-zinc-500">Total:</span>
                                <span className="text-cyan-300 font-mono ml-1">{log.totalTokens}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className={STYLES.modal.footer}>
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

export default RenderLogsModal;

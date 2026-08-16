export const STYLES = {
  container: "flex flex-col h-full bg-slate-950/35 overflow-hidden backdrop-blur-sm",
  
  header: {
    container: "h-16 border-b border-white/10 bg-slate-950/55 px-6 flex items-center justify-between shrink-0 backdrop-blur-xl",
    title: "text-lg font-bold text-white flex items-center gap-3",
    subtitle: "text-xs text-cyan-100/40 font-mono font-normal uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full",
    status: "text-[10px] text-cyan-100/60 font-mono uppercase bg-cyan-300/10 border border-cyan-200/15 px-2 py-1 rounded-full"
  },
  
  button: {
    primary: "h-12 bg-gradient-to-r from-cyan-300 to-sky-400 hover:from-cyan-200 hover:to-sky-300 text-slate-950 border border-cyan-200/60 shadow-lg shadow-cyan-500/20 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    secondary: "h-12 bg-white text-slate-950 hover:bg-slate-200 border border-white shadow-lg shadow-white/5 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    tertiary: "h-12 bg-white/[0.05] hover:bg-white/10 text-slate-300 border border-white/10 hover:border-cyan-300/30 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    disabled: "h-12 bg-white/[0.04] text-slate-600 border border-white/10 cursor-not-allowed rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    loading: "h-12 bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950 border border-cyan-200/60 cursor-wait rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all"
  },
  
  card: {
    base: "p-5 bg-white/[0.045] border border-white/10 rounded-2xl hover:border-cyan-200/35 transition-colors group cursor-pointer flex flex-col justify-between h-32 relative overflow-hidden backdrop-blur",
    active: "p-5 bg-white/[0.06] border border-cyan-300/50 cursor-wait rounded-2xl transition-all flex flex-col justify-between h-32 relative overflow-hidden backdrop-blur",
    loading: "absolute inset-0 bg-cyan-400/20 backdrop-blur-sm flex flex-col items-center justify-center z-10"
  },
  
  modal: {
    overlay: "fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4",
    container: "bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl shadow-cyan-950/30 backdrop-blur-xl",
    header: "p-6 border-b border-white/10 flex items-center justify-between",
    content: "flex-1 overflow-y-auto p-6 space-y-2",
    footer: "p-4 border-t border-white/10 bg-white/[0.04] flex justify-end items-center"
  },
  
  videoModal: {
    overlay: "fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4",
    container: "bg-slate-950/95 border border-cyan-200/15 rounded-[1.75rem] max-w-6xl w-full flex flex-col shadow-2xl shadow-cyan-950/30 overflow-hidden",
    player: "bg-black relative flex items-center justify-center overflow-hidden",
    controls: "p-4 border-t border-white/10 bg-white/[0.04] flex items-center justify-between shrink-0"
  },
  
  statusPanel: {
    container: "bg-white/[0.045] border border-white/10 rounded-[1.75rem] p-8 shadow-2xl shadow-slate-950/25 relative overflow-hidden group backdrop-blur",
    decoration: {
      top: "absolute top-0 right-0 p-48 bg-cyan-400/10 blur-[120px] rounded-full pointer-events-none",
      bottom: "absolute bottom-0 left-0 p-32 bg-emerald-900/5 blur-[100px] rounded-full pointer-events-none"
    },
    progressBadge: "text-right bg-white/[0.06] p-4 rounded-2xl border border-white/10 backdrop-blur-sm min-w-[160px]",
    stat: "flex flex-col",
    statLabel: "text-[9px] text-zinc-600 uppercase tracking-widest font-bold mb-0.5",
    statValue: "text-sm font-mono text-zinc-300"
  },
  
  timeline: {
    container: "h-20 bg-slate-950/55 rounded-2xl border border-white/10 flex items-center px-2 gap-1 overflow-x-auto custom-scrollbar relative shadow-inner",
    segment: "h-14 min-w-[4px] flex-1 rounded-[2px] transition-all relative group flex flex-col justify-end overflow-hidden",
    segmentComplete: "bg-cyan-500/25 border border-cyan-300/35 hover:bg-cyan-400/35",
    segmentIncomplete: "bg-slate-900/80 border border-white/10 hover:bg-white/10",
    tooltip: "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 whitespace-nowrap"
  },
  
  logItem: {
    container: "bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden hover:border-cyan-200/30 transition-colors backdrop-blur",
    header: "p-4 cursor-pointer",
    details: "px-4 pb-4 border-t border-white/10 pt-3 space-y-3"
  },
  
  statsPanel: {
    container: "p-6 border-b border-white/10 bg-slate-950/45",
    grid: "grid grid-cols-1 md:grid-cols-3 gap-4",
    card: "bg-white/[0.045] border border-white/10 rounded-2xl p-4",
    label: "text-[10px] text-zinc-600 uppercase tracking-widest font-bold mb-1"
  }
};

export const STATUS_COLORS = {
  success: 'text-green-400 bg-green-500/10 border-green-500/30',
  failed: 'text-red-400 bg-red-500/10 border-red-500/30',
  pending: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
};

export const LOG_TYPE_ICONS = {
  character: '👤',
  'character-variation': '👤',
  scene: '🎬',
  keyframe: '🖼️',
  video: '🎥',
  default: '📝'
};

export interface DownloadState {
  isDownloading: boolean;
  phase: string;
  progress: number;
}

export interface VideoPlayerState {
  showVideoPlayer: boolean;
  currentShotIndex: number;
  isPlaying: boolean;
}

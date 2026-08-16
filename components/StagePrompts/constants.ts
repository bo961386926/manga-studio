export const STYLES = {
  card: {
    base: 'bg-white/[0.045] border border-white/10 rounded-2xl p-4 backdrop-blur',
    nested: 'bg-slate-950/45 border border-white/10 rounded-xl p-3'
  },
  button: {
    edit: 'text-xs text-cyan-200 hover:text-white px-3 py-1 border border-cyan-300/30 rounded-xl hover:bg-cyan-300/10 transition-colors',
    editSmall: 'text-xs text-cyan-200 hover:text-white px-2 py-0.5 border border-cyan-300/30 rounded-lg hover:bg-cyan-300/10 transition-colors',
    editVideo: 'text-xs text-fuchsia-300 hover:text-white px-2 py-0.5 border border-fuchsia-400/30 rounded-lg hover:bg-fuchsia-400/10 transition-colors',
    save: 'flex items-center gap-1 px-3 py-1.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 text-xs rounded-xl transition-colors',
    saveSmall: 'flex items-center gap-1 px-2 py-1 bg-cyan-300 hover:bg-cyan-200 text-slate-950 text-xs rounded-lg transition-colors',
    saveVideo: 'flex items-center gap-1 px-2 py-1 bg-fuchsia-400 hover:bg-fuchsia-300 text-slate-950 text-xs rounded-lg transition-colors',
    cancel: 'flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs rounded-xl transition-colors',
    cancelSmall: 'flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/15 text-white text-xs rounded-lg transition-colors'
  },
  textarea: {
    base: 'w-full bg-white/[0.06] text-white rounded-xl border border-white/10 focus:border-cyan-300/40 focus:outline-none font-mono',
    large: 'p-3 min-h-[100px] text-sm',
    small: 'p-2 min-h-[80px] text-xs',
    video: 'p-2 min-h-[120px] text-xs'
  },
  display: {
    base: 'text-sm text-slate-300 bg-slate-950/45 p-3 rounded-xl border border-white/10 font-mono',
    small: 'text-xs text-zinc-400 font-mono whitespace-pre-wrap'
  },
  badge: {
    shotNumber: 'text-xs font-bold text-cyan-200 bg-cyan-300/10 px-2 py-0.5 rounded-full border border-cyan-200/15',
    keyframeStart: 'text-xs font-medium px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/30',
    keyframeEnd: 'text-xs font-medium px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30',
    videoPrompt: 'text-xs font-medium px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30'
  }
};

export type PromptCategory = 'characters' | 'scenes' | 'keyframes' | 'all';

export type EditingPrompt = {
  type: 'character' | 'character-variation' | 'scene' | 'keyframe' | 'video';
  id: string;
  variationId?: string;
  shotId?: string;
  value: string;
} | null;

export const STATUS_STYLES = {
  pending: 'text-amber-400 bg-amber-500/10',
  completed: 'text-green-400 bg-green-500/10',
  generating: 'text-yellow-400 bg-yellow-500/10',
  failed: 'text-red-400 bg-red-500/10',
  idle: 'text-zinc-500'
};

export const STATUS_LABELS = {
  pending: '排队中',
  completed: '✓ 已生成',
  generating: '生成中',
  failed: '失败',
  idle: '待生成'
};

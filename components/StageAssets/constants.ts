export const STYLES = {
  mainContainer: "flex flex-col h-full bg-slate-950/35 relative overflow-hidden backdrop-blur-sm",
  header: "h-16 border-b border-white/10 bg-slate-950/55 px-6 flex items-center justify-between shrink-0 backdrop-blur-xl",
  content: "flex-1 overflow-y-auto p-8 space-y-12 relative z-10",
  
  card: "bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden flex flex-col group hover:border-cyan-200/35 transition-all hover:shadow-xl hover:shadow-cyan-950/20 backdrop-blur",
  cardDark: "bg-slate-950/55 p-4 rounded-2xl border border-white/10",
  
  primaryButton: "px-4 py-2 bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20",
  secondaryButton: "px-4 py-2 bg-white/[0.05] text-slate-400 border border-white/10 hover:text-white hover:border-cyan-300/30 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2",
  iconButton: "p-2 hover:bg-white/10 rounded-full transition-colors",
  smallButton: "px-3 py-1.5 bg-white/[0.06] text-slate-300 hover:bg-white/10 rounded-xl text-[10px] font-bold transition-all border border-white/10 flex items-center gap-1",
  
  input: "w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40",
  textarea: "w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40 resize-none",
  
  imageContainer: "aspect-video bg-slate-950/70 relative rounded-2xl overflow-hidden cursor-pointer border border-white/10",
  imagePreview: "w-full h-full object-cover",
  
  badge: "px-2 py-1 bg-cyan-300/10 border border-cyan-200/15 rounded-full text-[10px] text-cyan-100/70 font-mono uppercase",
  
  modalOverlay: "absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center backdrop-blur-xl animate-in fade-in duration-200",
  modalContainer: "bg-slate-950/90 border border-cyan-200/15 w-full max-w-4xl max-h-[90vh] rounded-[1.75rem] flex flex-col shadow-2xl shadow-cyan-950/30 overflow-hidden",
  modalHeader: "h-16 px-8 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.04]",
  modalBody: "flex-1 overflow-y-auto p-8",
};

export const GRID_LAYOUTS = {
  cards: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6",
  twoColumn: "grid grid-cols-1 md:grid-cols-2 gap-8",
};

export const DEFAULTS = {
  language: '中文',
  visualStyle: 'live-action',
  genre: 'Cinematic',
  modelVersion: 'gpt-5.1',
  batchGenerateDelay: 3000,
};

export const REGIONAL_FEATURES = {
  Chinese: {
    character: 'Chinese person, East Asian facial features, Chinese ethnicity, ',
    scene: 'Chinese setting, East Asian architecture and aesthetics, ',
  },
  Japanese: {
    character: 'Japanese person, East Asian facial features, Japanese ethnicity, ',
    scene: 'Japanese setting, Japanese architecture and aesthetics, ',
  },
};

export const LANGUAGE_MAP: Record<string, keyof typeof REGIONAL_FEATURES> = {
  '中文': 'Chinese',
  'Chinese': 'Chinese',
  '日本語': 'Japanese',
  'Japanese': 'Japanese',
};

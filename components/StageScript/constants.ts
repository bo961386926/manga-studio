export const DURATION_OPTIONS = [
  { label: '30秒 (广告)', value: '30s' },
  { label: '60秒 (预告)', value: '60s' },
  { label: '2分钟 (片花)', value: '120s' },
  { label: '5分钟 (短片)', value: '300s' },
  { label: '15分钟 (长剧/单集)', value: '900s' },
  { label: '自定义', value: 'custom' }
];

export const LANGUAGE_OPTIONS = [
  { label: '中文 (Chinese)', value: '中文' },
  { label: 'English (US)', value: 'English' },
  { label: '日本語 (Japanese)', value: 'Japanese' },
  { label: 'Français (French)', value: 'French' },
  { label: 'Español (Spanish)', value: 'Spanish' }
];

export const MODEL_OPTIONS = [
  { label: 'GPT-5.1 (推荐)', value: 'gpt-5.1' },
  { label: 'GPT-5.2', value: 'gpt-5.2' },
  { label: 'GPT-4.1', value: 'gpt-41' },
  { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
  { label: '其他 (自定义)', value: 'custom' }
];

export const VISUAL_STYLE_OPTIONS = [
  { label: '🌟 日式动漫', value: 'anime', desc: '日本动漫风格，线条感强' },
  { label: '🎨 2D动画', value: '2d-animation', desc: '经典卓别林/迪士尼风格' },
  { label: '👾 3D动画', value: '3d-animation', desc: '皮克斯/梦工厂风格' },
  { label: '🌌 赛博朋克', value: 'cyberpunk', desc: '高科技赛博朋克风' },
  { label: '🖼️ 油画风格', value: 'oil-painting', desc: '油画质感艺术风' },
  { label: '🎬 真人影视', value: 'live-action', desc: '超写实电影/电视剧风格' },
  { label: '✨ 其他 (自定义)', value: 'custom', desc: '手动输入风格' }
];

export const STYLES = {
  input: 'w-full bg-white/[0.06] border border-white/10 text-white px-3 py-2.5 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/10 transition-all placeholder:text-slate-500',
  label: 'text-[10px] font-bold text-cyan-100/55 uppercase tracking-widest',
  select: 'w-full bg-white/[0.06] border border-white/10 text-white px-3 py-2.5 text-sm rounded-xl appearance-none focus:border-cyan-300/40 focus:outline-none transition-all cursor-pointer',
  button: {
    primary: 'bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 shadow-lg shadow-cyan-500/20',
    secondary: 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-cyan-300/30 hover:text-cyan-50',
    selected: 'bg-cyan-300 text-slate-950 border-cyan-300 shadow-sm shadow-cyan-500/20',
    disabled: 'bg-white/[0.05] text-slate-500 cursor-not-allowed border-white/10'
  },
  editor: {
    textarea: 'w-full bg-white/[0.06] border border-white/10 text-slate-200 px-3 py-2 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none resize-none',
    mono: 'font-mono',
    serif: 'font-serif italic'
  }
};

export const DEFAULTS = {
  duration: '60s',
  language: '中文',
  model: 'gpt-5.1',
  visualStyle: 'live-action'
};

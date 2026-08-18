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
  { label: '🌟 2D日漫', value: 'anime', desc: '日式动漫风格，线条感强', preview: '/styles/anime.png' },
  { label: '🎨 2D国漫', value: '2d-guoman', desc: '中国风 2D 国漫', preview: '/styles/2d-guoman.png' },
  { label: '💗 2D乙女', value: '2d-otome', desc: '乙女向 2D 风格，柔美细腻', preview: '/styles/2d-otome.png' },
  { label: '🇰🇷 2D韩漫', value: '2d-korean', desc: '韩式漫画风格', preview: '/styles/2d-korean.png' },
  { label: '🏙️ 2D韩漫都市', value: '2d-korean-urban', desc: '韩式都市漫画风', preview: '/styles/2d-korean-urban.png' },
  { label: '👾 3D卡通', value: '3d-animation', desc: '3D 卡通 / 皮克斯风格', preview: '/styles/3d-animation.png' },
  { label: '🐉 3D仙侠', value: '3d-xianxia', desc: '3D 仙侠玄幻风，国风山水与法术特效', preview: '/styles/3d-xianxia.png' },
  { label: '🏯 3D国风', value: '3d-guofeng', desc: '3D 中国古风场景', preview: '/styles/3d-guofeng.png' },
  { label: '🌌 CG赛博朋克', value: 'cyberpunk', desc: '高科技赛博朋克风', preview: '/styles/cyberpunk.png' },
  { label: '🖼️ CG风格', value: 'cg', desc: 'CG 渲染艺术风格', preview: '/styles/cg.png' },
  { label: '🖌️ 工笔画', value: 'gongbi', desc: '传统工笔画艺术风', preview: '/styles/gongbi.png' },
  { label: '🎬 写实电影感', value: 'live-action', desc: '超写实电影/电视剧风格', preview: '/styles/live-action.png' },
  { label: '🌆 写实都市', value: 'realistic-urban', desc: '写实都市场景', preview: '/styles/realistic-urban.png' },
  { label: '🎞️ 写实通用', value: 'realistic', desc: '通用写实风格', preview: '/styles/realistic.png' },
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

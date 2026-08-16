export const STYLES = {
  mainContainer: "flex flex-col h-full bg-slate-950/35 relative overflow-hidden",
  toolbar: "h-16 border-b border-white/10 bg-slate-950/55 px-6 flex items-center justify-between shrink-0 backdrop-blur-xl",
  workbench: "w-[480px] bg-slate-950/80 border-l border-white/10 flex flex-col h-full shadow-2xl shadow-cyan-950/30 animate-in slide-in-from-right-10 duration-300 relative z-20 backdrop-blur-2xl",
  workbenchHeader: "h-16 px-6 border-b border-white/10 flex items-center justify-between bg-white/[0.04] shrink-0",
  workbenchContent: "flex-1 overflow-y-auto p-6 space-y-8",
  
  card: "group relative flex flex-col bg-white/[0.045] border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 backdrop-blur",
  cardActive: "border-cyan-300/60 ring-1 ring-cyan-300/35 shadow-xl shadow-cyan-950/25 scale-[0.98]",
  cardInactive: "border-white/10 hover:border-cyan-200/35 hover:shadow-lg",
  
  primaryButton: "px-4 py-2 bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20",
  secondaryButton: "px-4 py-2 bg-white/[0.05] text-slate-400 border border-white/10 hover:text-white hover:border-cyan-300/30 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2",
  iconButton: "p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors",
  
  modalOverlay: "fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4",
  modalContainer: "bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] p-6 max-w-2xl w-full space-y-4 shadow-2xl shadow-cyan-950/30",
  modalTextarea: "w-full h-64 bg-white/[0.06] text-white border border-white/10 rounded-2xl p-4 text-sm outline-none focus:border-cyan-300/40 transition-colors resize-none",
  
  sectionHeader: "flex items-center gap-2 border-b border-white/10 pb-2",
  contentBox: "bg-white/[0.045] p-5 rounded-2xl border border-white/10 backdrop-blur",
};

export const VISUAL_STYLE_PROMPTS: Record<string, string> = {
  'live-action': 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution',
  'anime': 'Japanese anime style, cel-shaded, vibrant colors, expressive eyes, dynamic poses, Studio Ghibli/Makoto Shinkai quality',
  '2d-animation': 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth lines, expressive characters, painterly backgrounds',
  '3d-animation': 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering, detailed textures, stylized characters',
  'cyberpunk': 'cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays, high-tech low-life, Blade Runner style',
  'oil-painting': 'oil painting style, visible brushstrokes, rich textures, classical art composition, museum quality fine art',
};

export const VIDEO_PROMPT_TEMPLATES = {
  sora2: {
    chinese: `从第一张图片（起始帧）到第二张图片（结束帧）生成平滑过渡的视频。

动作描述：{actionSummary}

技术要求：
- 关键：视频必须从第一张图片的精确构图开始，逐渐过渡到第二张图片的精确构图结束
- 镜头运动：{cameraMovement}
- 过渡：确保起始帧和结束帧之间自然流畅的运动，避免跳跃或不连续
- 视觉风格：电影质感，全程保持一致的光照和色调
- 细节：保持两帧之间角色和场景的连续性和一致性
- 语言：配音和字幕使用中文`,
    
    english: `Generate a smooth transition video from the first image (start frame) to the second image (end frame).

Action Description: {actionSummary}

Technical Requirements:
- CRITICAL: The video MUST begin with the exact composition of the first image and gradually transition to end with the exact composition of the second image
- Camera Movement: {cameraMovement}
- Transition: Ensure natural and fluid motion between start and end frames, avoid jumps or discontinuities
- Visual Style: Cinematic quality with consistent lighting and color tone throughout
- Details: Maintain character and scene continuity and consistency between both frames
- Language: Use {language} for voiceover and subtitles`
  },
  
  veo: {
    simple: `{actionSummary}

镜头运动：{cameraMovement}
配音语言：使用{language}配音`
  }
};

export const DEFAULTS = {
  videoModel: 'sora-2' as const,
  batchGenerateDelay: 3000,
};

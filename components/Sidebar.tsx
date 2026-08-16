// Author: forsearch | Updated: 2026-04-30
import React from 'react';
import { LayoutDashboard, FileText, Users, Clapperboard, Film, ChevronLeft, ListTree, HelpCircle, Cpu, Sun, Moon, Monitor } from 'lucide-react';

interface SidebarProps {
  currentStage: string;
  setStage: (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => void;
  onExit: () => void;
  projectName?: string;
  onShowOnboarding?: () => void;
  onShowModelConfig?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentStage, setStage, onExit, projectName, onShowOnboarding, onShowModelConfig }) => {
  type ThemeMode = 'auto' | 'light' | 'dark';
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    try {
      const t = localStorage.getItem('ai_manga_theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  });

  const applyThemeMode = (mode: ThemeMode) => {
    let isLight: boolean;
    if (mode === 'light') isLight = true;
    else if (mode === 'dark') isLight = false;
    else isLight = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.classList.toggle('light', isLight);
    document.documentElement.setAttribute('data-theme', mode);
    try {
      localStorage.setItem('ai_manga_theme', mode);
    } catch (e) {}
  };

  const cycleTheme = () => {
    const next: ThemeMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(next);
    applyThemeMode(next);
  };

  const navItems = [
    { id: 'script', label: '剧情创作', icon: FileText, sub: 'Phase 01' },
    { id: 'assets', label: '场景角色', icon: Users, sub: 'Phase 02' },
    { id: 'director', label: 'AI工作台', icon: Clapperboard, sub: 'Phase 03' },
    { id: 'export', label: '制片导出', icon: Film, sub: 'Phase 04' },
    { id: 'prompts', label: '资产管理', icon: ListTree, sub: 'Advanced' },
  ];

  return (
    <aside className="w-72 bg-slate-950/75 border-r border-cyan-300/10 h-screen fixed left-0 top-0 flex flex-col z-50 select-none backdrop-blur-2xl shadow-2xl shadow-cyan-950/30">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.7),_rgba(2,6,23,0.92))]" />
      <div className="relative p-6 border-b border-white/10">
        <a 
          href="https://coderx.me/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 mb-6 group cursor-pointer"
        >
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-300/20 via-fuchsia-400/20 to-emerald-300/20 border border-white/15 flex items-center justify-center shadow-lg shadow-cyan-500/10 transition-transform group-hover:scale-105">
            <img src="/logo.svg" alt="Logo" className="w-7 h-7 flex-shrink-0" />
          </div>
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold text-white tracking-wider group-hover:text-cyan-100 transition-colors">漫剧工场</h1>
            <p className="text-[10px] text-cyan-200/50 tracking-widest group-hover:text-cyan-200/80 transition-colors">Creative Studio</p>
          </div>
        </a>

        <button 
          onClick={onExit}
          className="flex items-center gap-2 text-slate-400 hover:text-cyan-100 transition-colors text-xs font-mono uppercase tracking-wide group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          返回项目列表
        </button>
      </div>

      <div className="relative px-6 py-4 border-b border-white/10">
         <div className="text-[10px] text-cyan-200/45 uppercase tracking-widest mb-1">当前项目</div>
         <div className="text-sm font-medium text-slate-100 truncate font-mono">{projectName || '未命名项目'}</div>
      </div>

      <nav className="relative flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = currentStage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setStage(item.id as any)}
              className={`w-full flex items-center justify-between px-4 py-4 transition-all duration-200 group relative rounded-2xl border ${
                isActive 
                  ? 'border-cyan-300/40 bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-fuchsia-500/10 text-white shadow-lg shadow-cyan-500/10' 
                  : 'border-white/5 text-slate-400 hover:text-slate-100 hover:bg-white/5 hover:border-white/10'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                  isActive ? 'bg-cyan-300/15 border-cyan-200/25' : 'bg-slate-900/70 border-white/5 group-hover:border-white/10'
                }`}>
                  <item.icon className={`w-4 h-4 ${isActive ? 'text-cyan-200' : 'text-slate-500 group-hover:text-cyan-200/70'}`} />
                </span>
                <span className="font-medium text-xs tracking-wider uppercase">{item.label}</span>
              </div>
              <span className={`text-[10px] font-mono ${isActive ? 'text-cyan-100/60' : 'text-slate-600'}`}>{item.sub}</span>
            </button>
          );
        })}
      </nav>

      <div className="relative p-6 border-t border-white/10 space-y-3">
        {onShowOnboarding && (
          <button 
            onClick={onShowOnboarding}
            className="w-full flex items-center justify-between text-slate-500 hover:text-cyan-100 cursor-pointer transition-colors rounded-xl px-3 py-2 hover:bg-white/5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">新手引导</span>
            <HelpCircle className="w-4 h-4" />
          </button>
        )}
        {onShowModelConfig && (
          <button 
            onClick={onShowModelConfig}
            className="w-full flex items-center justify-between text-slate-500 hover:text-cyan-100 cursor-pointer transition-colors rounded-xl px-3 py-2 hover:bg-white/5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">模型配置</span>
            <Cpu className="w-4 h-4" />
          </button>
        )}
        <button 
          onClick={cycleTheme}
          className="w-full flex items-center justify-between text-slate-500 hover:text-cyan-100 cursor-pointer transition-colors rounded-xl px-3 py-2 hover:bg-white/5"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest">
            {themeMode === 'auto' ? '跟随系统' : themeMode === 'light' ? '浅色模式' : '深色模式'}
          </span>
          {themeMode === 'auto' ? <Monitor className="w-4 h-4" /> : themeMode === 'light' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
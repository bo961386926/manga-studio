// Author: forsearch | Updated: 2026-04-30
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import StageScript from './components/StageScript';
import StageAssets from './components/StageAssets';
import StageDirector from './components/StageDirector';
import StageExport from './components/StageExport';
import StagePrompts from './components/StagePrompts';
import Dashboard from './components/Dashboard';
import Onboarding, { shouldShowOnboarding, resetOnboarding } from './components/Onboarding';
import ModelConfigModal from './components/ModelConfig';
import ErrorBoundary from './components/ErrorBoundary';
import { ProjectState } from './types';
import { Save, CheckCircle, X } from 'lucide-react';
import { saveProjectToDB } from './services/storageService';
import { setGlobalApiKey } from './services/geminiService';
import { setLogCallback, clearLogCallback } from './services/renderLogService';
import { initRegistry, getGlobalApiKey } from './services/modelRegistry';

function App() {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showSaveStatus, setShowSaveStatus] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  
  const saveTimeoutRef = useRef<any>(null);
  const hideStatusTimeoutRef = useRef<any>(null);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 1024;
      setIsMobile(isMobileDevice);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // 从数据库初始化模型配置
    initRegistry().then(() => {
      // API Key 由 initRegistry 加载到 modelRegistry 后读取
      const storedKey = getGlobalApiKey();
      if (storedKey) {
        setApiKey(storedKey);
        setGlobalApiKey(storedKey);
      }
    });
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  const handleOnboardingQuickStart = (_option: 'script' | 'example') => {
    setShowOnboarding(false);
  };

  const handleShowOnboarding = () => {
    resetOnboarding();
    setShowOnboarding(true);
  };

  const handleSaveApiKey = (key: string) => {
    if (key) {
      setApiKey(key);
      setGlobalApiKey(key);
    } else {
      setApiKey('');
      setGlobalApiKey('');
    }
  };

  const handleShowModelConfig = () => {
    setShowModelConfig(true);
  };

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.name === 'ApiKeyError' || 
          event.error?.message?.includes('API Key missing') ||
          event.error?.message?.includes('AntSK API Key')) {
        console.warn('🔐 检测到 API Key 错误，请配置 API Key...');
        setShowModelConfig(true);
        event.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === 'ApiKeyError' ||
          event.reason?.message?.includes('API Key missing') ||
          event.reason?.message?.includes('AntSK API Key')) {
        console.warn('🔐 检测到 API Key 错误，请配置 API Key...');
        setShowModelConfig(true);
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (project) {
      setLogCallback((log) => {
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            renderLogs: [...(prev.renderLogs || []), log]
          };
        });
      });
    } else {
      clearLogCallback();
    }
    
    return () => clearLogCallback();
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;

    setSaveStatus('unsaved');
    setShowSaveStatus(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        // ═══ 自动保存前修剪 renderLogs，防止日志无限增长导致 payload 过大 ═══
        const MAX_RENDER_LOGS = 200;
        let projectToSave = project;
        if ((projectToSave.renderLogs?.length || 0) > MAX_RENDER_LOGS) {
          const trimmedLogs = projectToSave.renderLogs.slice(-MAX_RENDER_LOGS);
          projectToSave = { ...projectToSave, renderLogs: trimmedLogs };
          setProject(projectToSave);
          console.log(`[AutoSave] renderLogs 已修剪: ${project.renderLogs.length} → ${MAX_RENDER_LOGS}`);
        }

        const payloadSize = JSON.stringify(projectToSave).length;
        console.log(`[AutoSave] 开始保存项目 "${projectToSave.title}", payload 大小: ${(payloadSize / 1024 / 1024).toFixed(2)}MB`);
        await saveProjectToDB(projectToSave);
        const elapsed = Date.now();
        console.log(`[AutoSave] 保存成功 (${(Date.now() - elapsed + 1000).toFixed(0)}ms)`); // approximate
        setSaveStatus('saved');
      } catch (e: any) {
        // ═══ 保存失败不影响 UI，仅记录错误日志 ═══
        console.error(`[AutoSave] 保存失败:`, e?.message || e);
        setSaveStatus('unsaved');
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [project]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
      hideStatusTimeoutRef.current = setTimeout(() => {
        setShowSaveStatus(false);
      }, 2000);
    } else if (saveStatus === 'saving') {
      setShowSaveStatus(true);
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    }

    return () => {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    };
  }, [saveStatus]);


  const updateProject = (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return null;
      if (typeof updates === 'function') {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  };

  const setStage = (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => {
    updateProject({ stage });
  };

  const handleOpenProject = (proj: ProjectState) => {
    setProject(proj);
  };

  const handleExitProject = async () => {
    if (project) {
        await saveProjectToDB(project);
    }
    setProject(null);
  };

  const renderStage = () => {
    if (!project) return null;
    switch (project.stage) {
      case 'script':
        return <StageScript project={project} updateProject={updateProject} />;
      case 'assets':
        return <StageAssets project={project} updateProject={updateProject} />;
      case 'director':
        return <StageDirector project={project} updateProject={updateProject} />;
      case 'export':
        return <StageExport project={project} />;
      case 'prompts':
        return <StagePrompts project={project} updateProject={updateProject} />;
      default:
        return <div className="text-white">未知阶段</div>;
    }
  };

  if (isMobile) {
    return (
      <div className="h-screen bg-[#050505] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <img src="/logo.svg" alt="Logo" className="w-20 h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">漫剧工场</h1>
          <div className="bg-[#0A0A0A] border border-zinc-800 rounded-xl p-8">
            <p className="text-zinc-400 text-base leading-relaxed mb-4">
              为了获得最佳体验，请使用 PC 端浏览器访问。
            </p>
            <p className="text-zinc-600 text-sm">
              本应用需要较大的屏幕空间和桌面级浏览器环境才能正常运行。
            </p>
          </div>
          <div className="text-xs text-zinc-700">
            <a href="https://coderx.me/" target="_blank" rel="noreferrer" className="hover:text-indigo-400 transition-colors">
              访问产品首页了解更多
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
       <>
         <Dashboard 
           onOpenProject={handleOpenProject} 
           onShowOnboarding={handleShowOnboarding}
           onShowModelConfig={handleShowModelConfig}
         />
         {showOnboarding && (
           <Onboarding 
             onComplete={handleOnboardingComplete}
             onQuickStart={handleOnboardingQuickStart}
             currentApiKey={apiKey}
             onSaveApiKey={handleSaveApiKey}
           />
         )}
         <ModelConfigModal
           isOpen={showModelConfig}
           onClose={() => setShowModelConfig(false)}
         />
       </>
    );
  }

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.16),_transparent_34%),linear-gradient(135deg,_#07111f_0%,_#120b1f_48%,_#07130f_100%)] font-sans text-slate-100 selection:bg-cyan-400/25">
      <Sidebar 
        currentStage={project.stage} 
        setStage={setStage} 
        onExit={handleExitProject} 
        projectName={project.title}
        onShowOnboarding={handleShowOnboarding}
        onShowModelConfig={() => setShowModelConfig(true)}
      />
      
      <main className="ml-72 flex-1 h-screen overflow-hidden relative">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,_transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,_transparent_1px)] bg-[size:48px_48px] opacity-25" />
        <ErrorBoundary>
          {renderStage()}
        </ErrorBoundary>
        
        {showSaveStatus && (
          <div className="absolute top-4 right-6 pointer-events-none flex items-center gap-2 text-xs font-mono text-cyan-100 bg-slate-950/60 border border-cyan-300/20 px-3 py-1.5 rounded-full backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-lg shadow-cyan-500/10">
             {saveStatus === 'saving' ? (
               <>
                 <Save className="w-3 h-3 animate-pulse" />
                 保存中...
               </>
             ) : (
               <>
                 <CheckCircle className="w-3 h-3 text-emerald-400" />
                 已保存
               </>
             )}
          </div>
        )}
      </main>

      {showOnboarding && (
        <Onboarding 
          onComplete={handleOnboardingComplete}
          onQuickStart={handleOnboardingQuickStart}
          currentApiKey={apiKey}
          onSaveApiKey={handleSaveApiKey}
        />
      )}

      <ModelConfigModal
        isOpen={showModelConfig}
        onClose={() => setShowModelConfig(false)}
      />
    </div>
  );
}

export default App;
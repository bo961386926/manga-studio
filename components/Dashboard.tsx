// Author: forsearch | Updated: 2026-04-30
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Folder, ChevronRight, Calendar, AlertTriangle, X, HelpCircle, Cpu, Archive, Search, Users, MapPin, Sun, Moon, Monitor } from 'lucide-react';
import { ProjectState, AssetLibraryItem, Character, Scene } from '../types';
import { getAllProjectsMetadata, createNewProjectState, deleteProjectFromDB, getAllAssetLibraryItems, deleteAssetFromLibrary, loadProjectFromDB, saveProjectToDB } from '../services/storageService';
import { applyLibraryItemToProject } from '../services/assetLibraryService';
import { useAlert } from './GlobalAlert';

interface Props {
  onOpenProject: (project: ProjectState) => void;
  onShowOnboarding?: () => void;
  onShowModelConfig?: () => void;
}

const Dashboard: React.FC<Props> = ({ onOpenProject, onShowOnboarding, onShowModelConfig }) => {
  const { showAlert } = useAlert();
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene'>('all');
  const [assetToUse, setAssetToUse] = useState<AssetLibraryItem | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(() => {
    try {
      const t = localStorage.getItem('ai_manga_theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  });

  const applyThemeMode = (mode: 'auto' | 'light' | 'dark') => {
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
    const next = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(next);
    applyThemeMode(next);
  };

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const list = await getAllProjectsMetadata();
      setProjects(list);
    } catch (e) {
      console.error("Failed to load projects", e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLibrary = async () => {
    setIsLibraryLoading(true);
    try {
      const items = await getAllAssetLibraryItems();
      setLibraryItems(items);
    } catch (e) {
      console.error('Failed to load asset library', e);
    } finally {
      setIsLibraryLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (showLibraryModal) {
      loadLibrary();
    }
  }, [showLibraryModal]);

  const handleCreate = () => {
    const newProject = createNewProjectState();
    onOpenProject(newProject);
  };

  const requestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(null);
  };

  const confirmDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    try {
        await deleteProjectFromDB(id);
        await loadProjects();
    } catch (error) {
        console.error("删除项目失败:", error);
        showAlert(`删除项目失败: ${error instanceof Error ? error.message : '未知错误'}\n\n请检查浏览器控制台查看详细信息`, { type: 'error' });
    } finally {
        setDeleteConfirmId(null);
    }
  };

  const handleDeleteLibraryItem = (itemId: string) => {
    showAlert('确定从资产库删除该资源吗？', {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteAssetFromLibrary(itemId);
          setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
        } catch (error) {
          showAlert(`删除资产失败: ${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
        }
      }
    });
  };

  const handleUseAsset = async (projectId: string) => {
    if (!assetToUse) return;
    try {
      const project = await loadProjectFromDB(projectId);
      const updated = applyLibraryItemToProject(project, assetToUse);
      await saveProjectToDB(updated);
      onOpenProject(updated);
      setAssetToUse(null);
    } catch (error) {
      showAlert(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const filteredLibraryItems = libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    if (!libraryQuery.trim()) return true;
    const query = libraryQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query);
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(217,70,239,0.16),_transparent_30%),linear-gradient(135deg,_#07111f_0%,_#120b1f_48%,_#07130f_100%)] text-slate-200 p-6 md:p-10 font-sans selection:bg-cyan-300/25">
      <div className="max-w-7xl mx-auto flex gap-8">
        <aside className="w-64 flex-shrink-0 hidden md:flex flex-col justify-between rounded-[2rem] border border-white/10 bg-slate-950/50 p-5 backdrop-blur-2xl shadow-2xl shadow-cyan-950/20">
          <div>
            <div className="text-[10px] text-cyan-200/60 font-mono tracking-[0.3em] uppercase mb-3">
              Studio Lobby
            </div>
            <h1 className="text-3xl font-semibold text-white tracking-tight mb-3 flex items-center gap-2">
              项目库
            </h1>
            <div className="text-xs text-slate-400 leading-relaxed mb-8">
              从故事草稿到制片导出，集中管理你的短剧项目和可复用视觉资产。
            </div>

            <nav className="space-y-2">
              <button
                onClick={handleCreate}
                className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 transition-all text-[11px] font-bold tracking-widest uppercase rounded-2xl shadow-lg shadow-cyan-500/20"
              >
                <span className="flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  新建项目
                </span>
              </button>

              <button
                onClick={() => setShowLibraryModal(true)}
                className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-medium tracking-widest uppercase border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 hover:bg-white/5 transition-colors rounded-2xl"
              >
                <span className="flex items-center gap-2">
                  <Archive className="w-3.5 h-3.5" />
                  资产库
                </span>
              </button>

              {onShowModelConfig && (
                <button
                  onClick={onShowModelConfig}
                  className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-medium tracking-widest uppercase border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 hover:bg-white/5 transition-colors rounded-2xl"
                >
                  <span className="flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5" />
                    模型配置
                  </span>
                </button>
              )}

              {onShowOnboarding && (
                <button
                  onClick={onShowOnboarding}
                  className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-medium tracking-widest uppercase border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 hover:bg-white/5 transition-colors rounded-2xl"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle className="w-3.5 h-3.5" />
                    帮助
                  </span>
                </button>
              )}

              <button
                onClick={cycleTheme}
                className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-medium tracking-widest uppercase border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 hover:bg-white/5 transition-colors rounded-2xl"
              >
                <span className="flex items-center gap-2">
                  {themeMode === 'auto' ? <Monitor className="w-3.5 h-3.5" /> : themeMode === 'light' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {themeMode === 'auto' ? '跟随系统' : themeMode === 'light' ? '浅色模式' : '深色模式'}
                </span>
              </button>
            </nav>
          </div>

          <div className="pt-6 border-t border-white/10 text-[10px] text-slate-500 font-mono leading-relaxed">
            <p>左侧导航整合了项目创建、资产库和配置入口，方便快速切换。</p>
          </div>
        </aside>

        <main className="flex-1">
          <div className="md:hidden mb-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">项目库</h1>
                <div className="text-[11px] text-cyan-200/60 font-mono tracking-widest uppercase mt-1">
                  Studio Lobby
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleCreate}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 transition-colors text-[11px] font-bold tracking-widest uppercase rounded-2xl"
              >
                <Plus className="w-3.5 h-3.5" />
                新建项目
              </button>
              <button
                onClick={() => setShowLibraryModal(true)}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 px-4 py-2 border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 transition-colors text-[11px] font-medium tracking-widest uppercase rounded-2xl bg-white/5"
              >
                <Archive className="w-3.5 h-3.5" />
                资产库
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 text-zinc-600 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            
            <div 
              onClick={handleCreate}
              className="group cursor-pointer border border-dashed border-cyan-200/20 hover:border-cyan-200/50 bg-white/[0.04] hover:bg-cyan-300/[0.08] backdrop-blur-xl flex flex-col items-center justify-center min-h-[240px] transition-all rounded-[1.75rem] shadow-xl shadow-slate-950/20"
            >
              <div className="w-14 h-14 border border-cyan-200/20 bg-cyan-300/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-cyan-300/20 transition-colors">
                <Plus className="w-5 h-5 text-cyan-100 group-hover:text-white" />
              </div>
              <span className="text-cyan-100/60 font-mono text-[10px] uppercase tracking-widest group-hover:text-cyan-50">Create New Project</span>
            </div>

            {projects.map((proj) => (
              <div 
                key={proj.id}
                onClick={() => onOpenProject(proj)}
                className="group bg-slate-950/55 border border-white/10 hover:border-cyan-200/35 p-0 flex flex-col cursor-pointer transition-all relative overflow-hidden h-[240px] rounded-[1.75rem] backdrop-blur-xl shadow-xl shadow-slate-950/25 hover:-translate-y-1 hover:shadow-cyan-950/30"
              >
                  {deleteConfirmId === proj.id && (
                    <div 
                        className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-6 space-y-4 animate-in fade-in duration-200 backdrop-blur-xl"
                        onClick={(e) => e.stopPropagation()} 
                    >
                        <div className="w-10 h-10 bg-red-900/20 flex items-center justify-center rounded-full">
                           <AlertTriangle className="w-5 h-5 text-red-500" />
                        </div>
                        <div className="text-center space-y-2">
                            <p className="text-white font-bold text-xs uppercase tracking-widest">确认删除项目？</p>
                            <p className="text-zinc-500 text-[10px] font-mono">此操作无法撤销</p>
                            <div className="text-[9px] text-zinc-600 space-y-1 pt-2 border-t border-zinc-900">
                              <p>将同时删除以下所有资源：</p>
                              <p className="text-zinc-700 font-mono">· 角色和场景参考图</p>
                              <p className="text-zinc-700 font-mono">· 所有关键帧图像</p>
                              <p className="text-zinc-700 font-mono">· 所有生成的视频片段</p>
                              <p className="text-zinc-700 font-mono">· 渲染历史记录</p>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full pt-2">
                            <button 
                                onClick={cancelDelete}
                                className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-colors border border-white/10 rounded-xl"
                            >
                                取消
                            </button>
                            <button 
                                onClick={(e) => confirmDelete(e, proj.id)}
                                className="flex-1 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-100 text-[10px] font-bold uppercase tracking-wider transition-colors border border-red-400/20 rounded-xl"
                            >
                                永久删除
                            </button>
                        </div>
                    </div>
                  )}

                  <div className="flex-1 p-6 relative flex flex-col">
                     <button 
                        onClick={(e) => requestDelete(e, proj.id)}
                        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-2 hover:bg-white/10 text-slate-500 hover:text-red-300 transition-all rounded-xl z-10"
                        title="删除项目"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                     <div className="flex-1">
                        <Folder className="w-9 h-9 text-cyan-300/25 mb-6 group-hover:text-cyan-200/70 transition-colors" />
                        <h3 className="text-sm font-bold text-white mb-2 line-clamp-1 tracking-wide">{proj.title}</h3>
                        <div className="flex flex-wrap gap-2 mb-4">
                            <span className="text-[9px] font-mono text-cyan-100/70 border border-cyan-200/15 bg-cyan-300/10 px-2 py-1 uppercase tracking-wider rounded-full">
                              {proj.stage === 'script' ? '剧情创作' :
                               proj.stage === 'assets' ? '场景角色' :
                               proj.stage === 'director' ? 'AI工作台' :
                               proj.stage === 'export' ? '制片导出' :
                               proj.stage === 'prompts' ? '资产管理' : '未知'}
                            </span>
                        </div>
                        {proj.scriptData?.logline && (
                            <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed font-mono border-l border-cyan-200/20 pl-2">
                            {proj.scriptData.logline}
                            </p>
                        )}
                     </div>
                  </div>

                  <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between bg-white/[0.03]">
                    <div className="flex items-center gap-2 text-[9px] text-slate-500 font-mono uppercase tracking-widest">
                        <Calendar className="w-3 h-3" />
                        {formatDate(proj.lastModified)}
                    </div>
                    <ChevronRight className="w-3 h-3 text-cyan-200/30 group-hover:text-cyan-100 transition-colors" />
                  </div>
              </div>
            ))}
          </div>
          )}
        </main>
      </div>

      {showLibraryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-xl" onClick={() => setShowLibraryModal(false)}>
          <div
            className="relative w-full max-w-6xl bg-slate-950/90 border border-cyan-200/15 p-6 md:p-8 rounded-[1.75rem] shadow-2xl shadow-cyan-950/30"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowLibraryModal(false)}
              className="absolute right-4 top-4 p-2 text-slate-500 hover:text-white hover:bg-white/10 transition-colors rounded-xl"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-end justify-between border-b border-white/10 pb-6 mb-6">
              <div>
                <h2 className="text-lg text-white flex items-center gap-2">
                  <Archive className="w-4 h-4 text-cyan-300" />
                  资产库
                  <span className="text-cyan-100/40 text-xs font-mono uppercase tracking-widest">Asset Library</span>
                </h2>
                <p className="text-xs text-slate-400 mt-2">
                  在项目「场景角色」中将内容加入资产库，跨项目复用
                </p>
              </div>
              <div className="text-[10px] text-cyan-100/50 font-mono uppercase tracking-widest">
                {libraryItems.length} assets
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-cyan-100/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="搜索资产名称..."
                  className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40"
                />
              </div>
              <div className="flex gap-2">
                {(['all', 'character', 'scene'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setLibraryFilter(type)}
                    className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border rounded ${
                      libraryFilter === type
                        ? 'bg-cyan-300 text-slate-950 border-cyan-300'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:text-white hover:border-cyan-300/30'
                    }`}
                  >
                    {type === 'all' ? '全部' : type === 'character' ? '角色' : '场景'}
                  </button>
                ))}
              </div>
            </div>

            {isLibraryLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
              </div>
            ) : filteredLibraryItems.length === 0 ? (
                <div className="border border-dashed border-cyan-200/15 rounded-2xl p-10 text-center text-slate-500 text-sm">
                暂无资产。可在项目的「场景角色」中加入资产库。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredLibraryItems.map((item) => {
                  const preview =
                    item.type === 'character'
                      ? (item.data as Character).referenceImage
                      : (item.data as Scene).referenceImage;
                  return (
                    <div
                      key={item.id}
                      className="bg-white/[0.04] border border-white/10 hover:border-cyan-200/35 transition-colors rounded-2xl overflow-hidden backdrop-blur"
                    >
                      <div className="aspect-video bg-slate-950/70">
                        {preview ? (
                          <img src={preview} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-700">
                            {item.type === 'character' ? (
                              <Users className="w-8 h-8 opacity-30" />
                            ) : (
                              <MapPin className="w-8 h-8 opacity-30" />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="p-4 space-y-3">
                        <div>
                          <div className="text-sm text-white font-bold line-clamp-1">{item.name}</div>
                          <div className="text-[10px] text-cyan-100/50 font-mono uppercase tracking-widest mt-1">
                            {item.type === 'character' ? '角色' : '场景'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAssetToUse(item)}
                            className="flex-1 py-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                          >
                            选择项目使用
                          </button>
                          <button
                            onClick={() => handleDeleteLibraryItem(item.id)}
                            className="p-2 border border-white/10 text-slate-500 hover:text-red-300 hover:border-red-400/40 rounded-xl transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {assetToUse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-xl" onClick={() => setAssetToUse(null)}>
          <div
            className="relative w-full max-w-2xl bg-slate-950/90 border border-cyan-200/15 p-6 md:p-8 rounded-[1.75rem] shadow-2xl shadow-cyan-950/30"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setAssetToUse(null)}
              className="absolute right-4 top-4 p-2 text-slate-500 hover:text-white hover:bg-white/10 transition-colors rounded-xl"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="space-y-4">
              <div className="text-white text-sm font-bold tracking-widest uppercase">选择项目使用</div>
              <div className="text-[10px] text-cyan-100/55 font-mono">
                将资产“{assetToUse.name}”导入到以下项目
              </div>
              {projects.length === 0 ? (
                <div className="text-zinc-600 text-sm">暂无项目可用</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {projects.map((proj) => (
                    <button
                      key={proj.id}
                      onClick={() => handleUseAsset(proj.id)}
                      className="p-4 text-left border border-white/10 hover:border-cyan-300/30 bg-white/[0.04] hover:bg-white/[0.07] transition-colors rounded-2xl"
                    >
                      <div className="text-sm text-white font-bold line-clamp-1">{proj.title}</div>
                      <div className="text-[10px] text-zinc-500 font-mono mt-1">最后修改: {formatDate(proj.lastModified)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

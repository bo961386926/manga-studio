import React, { useState, useEffect } from 'react';
import { 
  Server, 
  MessageSquare, 
  Image, 
  Video, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  ExternalLink,
  Sparkles,
  Gift
} from 'lucide-react';
import { useAlert } from './GlobalAlert';
import { 
  ModelProvider, 
  ModelConfig, 
  AspectRatio, 
  VideoDuration 
} from '../types';
import {
  getModelManagerState,
  getProviders,
  getCurrentConfig,
  addProvider,
  updateProvider,
  deleteProvider,
  updateChatModelConfig,
  updateImageModelConfig,
  updateVideoModelConfig,
  setDefaultAspectRatio,
  setDefaultVideoDuration,
  AVAILABLE_CHAT_MODELS,
  AVAILABLE_IMAGE_MODELS,
  AVAILABLE_VIDEO_MODELS
} from '../services/modelConfigService';

interface ModelManagerTabProps {
  onConfigChange?: () => void;
}

const ModelManagerTab: React.FC<ModelManagerTabProps> = ({ onConfigChange }) => {
  const { showAlert } = useAlert();
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [defaultAspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [defaultVideoDuration, setDuration] = useState<VideoDuration>(8);
  
  // 编辑状态
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [newProviderForm, setNewProviderForm] = useState({ name: '', baseUrl: '', apiKey: '' });

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = () => {
    const state = getModelManagerState();
    setProviders(state.providers);
    setConfig(state.currentConfig);
    setAspectRatio(state.defaultAspectRatio);
    setDuration(state.defaultVideoDuration);
  };

  // 添加提供商
  const handleAddProvider = () => {
    if (!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()) return;
    
    addProvider({
      name: newProviderForm.name.trim(),
      baseUrl: newProviderForm.baseUrl.trim(),
      apiKey: newProviderForm.apiKey.trim() || undefined,
      isDefault: false
    });
    
    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setIsAddingProvider(false);
    loadConfig();
    onConfigChange?.();
  };

  // 开始编辑提供商
  const handleStartEdit = (provider: ModelProvider) => {
    setEditingProviderId(provider.id);
    setEditForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey || ''
    });
  };

  // 保存编辑
  const handleSaveEdit = (id: string) => {
    updateProvider(id, {
      name: editForm.name.trim(),
      baseUrl: editForm.baseUrl.trim(),
      apiKey: editForm.apiKey.trim() || undefined
    });
    setEditingProviderId(null);
    loadConfig();
    onConfigChange?.();
  };

  // 删除提供商
  const handleDeleteProvider = (id: string) => {
    showAlert('确定要删除这个提供商吗？', {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        deleteProvider(id);
        loadConfig();
        onConfigChange?.();
        showAlert('提供商已删除', { type: 'success' });
      }
    });
  };

  // 更新模型配置
  const handleChatModelChange = (modelName: string) => {
    updateChatModelConfig({ modelName });
    loadConfig();
    onConfigChange?.();
  };

  const handleVideoModelChange = (value: string, type: 'sora' | 'veo') => {
    updateVideoModelConfig({ modelName: value, type });
    loadConfig();
    onConfigChange?.();
  };

  const handleAspectRatioChange = (ratio: AspectRatio) => {
    setDefaultAspectRatio(ratio);
    setAspectRatio(ratio);
    onConfigChange?.();
  };

  const handleDurationChange = (duration: VideoDuration) => {
    setDefaultVideoDuration(duration);
    setDuration(duration);
    onConfigChange?.();
  };

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* 折扣广告卡片 */}
      <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/30 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              推荐使用 GitCC API
            </h3>
            <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
              支持 GPT-5.1、Gemini-3、Veo 3.1、Sora-2 等多种模型，稳定快速，价格优惠。
              本开源项目由 GitCC API 提供支持。
            </p>
            <div className="flex items-center gap-3">
              <a 
                href="https://coderx.me/" 
                target="_blank" 
                rel="noreferrer"
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-zinc-200 transition-colors inline-flex items-center gap-1.5"
              >
                立即购买
                <ExternalLink className="w-3 h-3" />
              </a>
              {/* 使用教程已隐藏 */}
            </div>
          </div>
        </div>
      </div>

      {/* 提供商列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
            <Server className="w-3.5 h-3.5" />
            API 提供商
          </label>
          {!isAddingProvider && (
            <button
              onClick={() => setIsAddingProvider(true)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              添加提供商
            </button>
          )}
        </div>

        <div className="space-y-2">
          {/* 添加新提供商表单 */}
          {isAddingProvider && (
            <div className="bg-zinc-900/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <input
                type="text"
                placeholder="提供商名称"
                value={newProviderForm.name}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, name: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="API 基础 URL（如 https://api.example.com）"
                value={newProviderForm.baseUrl}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, baseUrl: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
              />
              <input
                type="password"
                placeholder="独立 API Key（可选，不填则使用全局 Key）"
                value={newProviderForm.apiKey}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddProvider}
                  disabled={!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()}
                  className="flex-1 py-2 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  确认添加
                </button>
                <button
                  onClick={() => {
                    setIsAddingProvider(false);
                    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
                  }}
                  className="px-4 py-2 bg-zinc-800 text-zinc-400 text-xs rounded hover:bg-zinc-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* 提供商列表 */}
          {providers.map((provider) => (
            <div 
              key={provider.id}
              className={`bg-zinc-900/50 border rounded-lg p-3 ${
                provider.isDefault ? 'border-indigo-500/50' : 'border-zinc-800'
              }`}
            >
              {editingProviderId === provider.id ? (
                // 编辑模式
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none"
                    disabled={provider.isBuiltIn}
                  />
                  <input
                    type="text"
                    value={editForm.baseUrl}
                    onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
                    disabled={provider.isBuiltIn}
                  />
                  <input
                    type="password"
                    placeholder="独立 API Key（可选）"
                    value={editForm.apiKey}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(provider.id)}
                      className="flex-1 py-2 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      保存
                    </button>
                    <button
                      onClick={() => setEditingProviderId(null)}
                      className="px-4 py-2 bg-zinc-800 text-zinc-400 text-xs rounded hover:bg-zinc-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                // 显示模式
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{provider.name}</span>
                      {provider.isDefault && (
                        <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] rounded">默认</span>
                      )}
                      {provider.isBuiltIn && (
                        <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 text-[10px] rounded">内置</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{provider.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartEdit(provider)}
                      className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {!provider.isBuiltIn && (
                      <button
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 模型选择 */}
      <div className="grid grid-cols-1 gap-4">
        {/* 对话模型 */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5" />
            对话模型
          </label>
          <select
            value={config.chatModel.modelName}
            onChange={(e) => handleChatModelChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white px-3 py-2.5 text-xs rounded-lg focus:border-indigo-500 focus:outline-none"
          >
            {AVAILABLE_CHAT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.name} - {m.description}
              </option>
            ))}
          </select>
        </div>

        {/* 视频模型 */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <Video className="w-3.5 h-3.5" />
            视频模型
          </label>
          <select
            value={`${config.videoModel.type}:${config.videoModel.modelName}`}
            onChange={(e) => {
              const [type, value] = e.target.value.split(':');
              handleVideoModelChange(value, type as 'sora' | 'veo');
            }}
            className="w-full bg-zinc-900 border border-zinc-800 text-white px-3 py-2.5 text-xs rounded-lg focus:border-indigo-500 focus:outline-none"
          >
            {AVAILABLE_VIDEO_MODELS.map((m) => (
              <option key={m.value} value={`${m.type}:${m.value}`}>
                {m.name} - {m.description}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 默认设置 */}
      <div className="pt-4 border-t border-zinc-900">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">
          默认生成设置
        </label>
        
        <div className="grid grid-cols-2 gap-4">
          {/* 默认横竖屏 */}
          <div>
            <label className="text-[10px] text-zinc-600 mb-1.5 block">默认比例</label>
            <div className="flex gap-1">
              {(['16:9', '9:16', '1:1'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => handleAspectRatioChange(ratio)}
                  className={`flex-1 py-2 text-xs rounded transition-colors ${
                    defaultAspectRatio === ratio
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {ratio === '16:9' ? '横屏' : ratio === '9:16' ? '竖屏' : '方形'}
                </button>
              ))}
            </div>
          </div>

          {/* 默认时长 */}
          <div>
            <label className="text-[10px] text-zinc-600 mb-1.5 block">默认时长 (Sora)</label>
            <div className="flex gap-1">
              {([4, 8, 12] as VideoDuration[]).map((d) => (
                <button
                  key={d}
                  onClick={() => handleDurationChange(d)}
                  className={`flex-1 py-2 text-xs rounded transition-colors ${
                    defaultVideoDuration === d
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {d}秒
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelManagerTab;

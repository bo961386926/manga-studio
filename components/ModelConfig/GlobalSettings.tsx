/**
 * 全局配置组件
 * 包含各服务商 API Key 配置
 */

import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle, AlertCircle, ExternalLink, Server, Shield, Layers } from 'lucide-react';
import { getProviders, updateProvider, setGlobalApiKey, getKeyMode, setKeyMode } from '../../services/modelRegistry';

interface GlobalSettingsProps {
  onRefresh: () => void;
}

interface ProviderKeyState {
  apiKey: string;
  verifying: boolean;
  status: 'idle' | 'success' | 'error';
  message: string;
}

const PROVIDER_LINKS: Record<string, { label: string; url: string; color: string }> = {
  aliyun: { label: '获取阿里云 Key', url: 'https://bailian.console.aliyun.com/', color: 'from-orange-400 to-red-500' },
  deepseek: { label: '获取 DeepSeek Key', url: 'https://platform.deepseek.com/', color: 'from-blue-400 to-indigo-500' },
  volcengine: { label: '获取火山引擎 Key', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', color: 'from-purple-400 to-pink-500' },
  minimax: { label: '获取 MiniMax Key', url: 'https://platform.minimaxi.com/', color: 'from-emerald-400 to-teal-500' },
};

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onRefresh }) => {
  const [providers, setProviders] = useState<Array<{ id: string; name: string; baseUrl: string; apiKey?: string; isBuiltIn: boolean }>>([]);
  const [providerKeys, setProviderKeys] = useState<Record<string, ProviderKeyState>>({});
  const [keyMode, setKeyModeState] = useState<'global' | 'mixed'>('mixed');

  useEffect(() => {
    // 加载 Key 使用模式
    setKeyModeState(getKeyMode());
    
    // 加载所有提供商
    const allProviders = getProviders();
    setProviders(allProviders);
    
    // 初始化各提供商的 API Key 状态
    const keys: Record<string, ProviderKeyState> = {};
    allProviders.forEach(p => {
      const savedKey = p.apiKey || '';
      keys[p.id] = {
        apiKey: savedKey,
        verifying: false,
        status: savedKey ? 'success' : 'idle',
        message: savedKey ? '已配置' : '',
      };
    });
    setProviderKeys(keys);
  }, []);

  const handleSetMode = (mode: 'global' | 'mixed') => {
    setKeyModeState(mode);
    setKeyMode(mode);
    onRefresh();
  };

  const handleSaveProviderKey = (providerId: string) => {
    const state = providerKeys[providerId];
    if (!state || !state.apiKey.trim()) {
      setProviderKeys(prev => ({
        ...prev,
        [providerId]: { ...prev[providerId], status: 'error', message: '请输入 API Key' },
      }));
      return;
    }
    
    const ok = updateProvider(providerId, { apiKey: state.apiKey.trim() });
    // 同时存为全局 Key 作为双保险
    setGlobalApiKey(state.apiKey.trim());
    
    if (ok) {
      setProviderKeys(prev => ({
        ...prev,
        [providerId]: { ...prev[providerId], status: 'success', message: `${providers.find(p => p.id === providerId)?.name || ''} API Key 已保存` },
      }));
    } else {
      setProviderKeys(prev => ({
        ...prev,
        [providerId]: { ...prev[providerId], status: 'error', message: '保存失败，请重试' },
      }));
    }
    onRefresh();
  };

  const handleClearProviderKey = (providerId: string) => {
    updateProvider(providerId, { apiKey: undefined } as any);
    setProviderKeys(prev => ({
      ...prev,
      [providerId]: { apiKey: '', ...prev[providerId], status: 'idle', message: '' },
    }));
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* API Key 使用模式 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-cyan-300" />
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            API Key 使用模式
          </label>
        </div>

        <div className="bg-white/[0.045] border border-white/10 rounded-2xl p-4">
          <div className="flex gap-2">
            <button
              onClick={() => handleSetMode('global')}
              className={`flex-1 px-4 py-3 text-xs font-bold rounded-xl border transition-colors ${
                keyMode === 'global'
                  ? 'bg-cyan-300/20 border-cyan-200/40 text-cyan-200'
                  : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              全局模式
            </button>
            <button
              onClick={() => handleSetMode('mixed')}
              className={`flex-1 px-4 py-3 text-xs font-bold rounded-xl border transition-colors ${
                keyMode === 'mixed'
                  ? 'bg-cyan-300/20 border-cyan-200/40 text-cyan-200'
                  : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              混合模式
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
            {keyMode === 'global'
              ? '所有模型统一使用同一个 API Key（取第一个已配置的服务商 Key）。适合只用一个服务商 Key 的场景。'
              : '各服务商可单独配置 Key（优先使用），未配置时回退到其他已配置的 Key。适合混合使用多个服务商的场景。'}
          </p>
        </div>
      </div>

      {/* 各服务商 API Key 配置 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-cyan-300" />
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            服务商 API Key
          </label>
        </div>
        
        <div className="space-y-3">
          {providers.map((provider) => {
            const state = providerKeys[provider.id];
            const linkInfo = PROVIDER_LINKS[provider.id];
            
            return (
              <div key={provider.id} className="bg-white/[0.045] border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white">{provider.name}</h4>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{provider.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-cyan-400/60" />
                    <span className="text-[10px] text-zinc-500">API Key</span>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={state?.apiKey || ''}
                    onChange={(e) => setProviderKeys(prev => ({
                      ...prev,
                      [provider.id]: { ...prev[provider.id], apiKey: e.target.value, status: 'idle', message: '' },
                    }))}
                    placeholder={`输入 ${provider.name} 的 API Key...`}
                    className="flex-1 bg-white/[0.06] border border-white/10 text-white px-3 py-2 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/10 transition-all font-mono placeholder:text-slate-500"
                  />
                  <button
                    onClick={() => handleSaveProviderKey(provider.id)}
                    className="px-3 py-2 bg-cyan-300/20 border border-cyan-200/30 text-cyan-300 text-xs rounded-xl hover:bg-cyan-300/30 transition-colors"
                  >
                    保存
                  </button>
                  {state?.status === 'success' && (
                    <button
                      onClick={() => handleClearProviderKey(provider.id)}
                      className="px-2 py-2 text-zinc-500 hover:text-red-400 text-xs rounded-xl hover:bg-red-500/10 transition-colors"
                    >
                      清除
                    </button>
                  )}
                </div>
                
                {/* 状态提示 */}
                {state?.message && (
                  <div className={`flex items-center gap-2 text-xs mt-2 ${
                    state.status === 'success' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {state.status === 'success' ? (
                      <CheckCircle className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {state.message}
                  </div>
                )}
                
                {/* 获取链接 */}
                {linkInfo && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <a 
                      href={linkInfo.url}
                      target="_blank" 
                      rel="noreferrer"
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors inline-flex items-center gap-1"
                    >
                      {linkInfo.label}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GlobalSettings;

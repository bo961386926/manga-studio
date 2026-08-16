/**
 * 全局配置组件
 * 包含各服务商 API Key 配置
 */

import React, { useState, useEffect } from 'react';
import { Key, Loader2, CheckCircle, AlertCircle, ExternalLink, Server, Shield } from 'lucide-react';
import { getProviders, updateProvider, getGlobalApiKey, setGlobalApiKey } from '../../services/modelRegistry';

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
};

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onRefresh }) => {
  const [globalKey, setGlobalKey] = useState('');
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [globalMessage, setGlobalMessage] = useState('');
  const [providers, setProviders] = useState<Array<{ id: string; name: string; baseUrl: string; apiKey?: string; isBuiltIn: boolean }>>([]);
  const [providerKeys, setProviderKeys] = useState<Record<string, ProviderKeyState>>({});
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'restored' | 'empty'>('idle');

  useEffect(() => {
    const currentGlobalKey = getGlobalApiKey() || '';
    setGlobalKey(currentGlobalKey);
    if (currentGlobalKey) {
      setGlobalStatus('success');
      setGlobalMessage('全局 API Key 已配置（备用）');
      setRestoreStatus('restored');
    } else {
      setRestoreStatus('empty');
    }
    
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

  const handleSaveGlobalKey = () => {
    if (!globalKey.trim()) {
      setGlobalStatus('error');
      setGlobalMessage('请输入 API Key');
      return;
    }
    setGlobalApiKey(globalKey.trim());
    setGlobalStatus('success');
    setGlobalMessage('全局 API Key 已保存');
    onRefresh();
  };

  const handleClearGlobalKey = () => {
    setGlobalKey('');
    setGlobalStatus('idle');
    setGlobalMessage('');
    setGlobalApiKey('');
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
      <div className={`rounded-2xl border px-4 py-3 text-sm ${restoreStatus === 'restored' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'}`}>
        {restoreStatus === 'restored' ? '已恢复上次保存的 API Key。你现在可以直接继续使用。' : '当前还没有恢复到已保存的 API Key；如需要请在下方重新保存。'}
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

      {/* 全局 API Key（备用） */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-zinc-500" />
          <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            全局 API Key（备用）
          </label>
        </div>
        
        <div className="bg-white/[0.025] border border-white/5 rounded-2xl p-4">
          <p className="text-[10px] text-zinc-600 mb-3 leading-relaxed">
            当服务商未单独设置 API Key 时，将使用此全局 Key 作为备用。
          </p>
          
          <div className="space-y-3">
            <input
              type="password"
              value={globalKey}
              onChange={(e) => {
                setGlobalKey(e.target.value);
                setGlobalStatus('idle');
                setGlobalMessage('');
              }}
              placeholder="输入备用 API Key（可选）..."
              className="w-full bg-white/[0.06] border border-white/10 text-white px-4 py-3 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/10 transition-all font-mono placeholder:text-slate-500"
            />
            
            {globalMessage && (
              <div className={`flex items-center gap-2 text-xs ${
                globalStatus === 'success' ? 'text-green-400' : 'text-red-400'
              }`}>
                {globalStatus === 'success' ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {globalMessage}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSaveGlobalKey}
                className="px-4 py-2 bg-cyan-300/20 border border-cyan-200/30 text-cyan-300 text-xs rounded-xl hover:bg-cyan-300/30 transition-colors"
              >
                保存全局 Key
              </button>
              {globalStatus === 'success' && (
                <button
                  onClick={handleClearGlobalKey}
                  className="px-4 py-2 text-zinc-500 hover:text-red-400 text-xs rounded-xl hover:bg-red-500/10 transition-colors"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalSettings;

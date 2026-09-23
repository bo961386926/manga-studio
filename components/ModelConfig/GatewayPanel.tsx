// Gateway model management panel (stage-3 self-hosted models).
// Private providers are user-scoped; shared providers/models are admin-only.
// Credentials only ever show a configured/masked state. Styling follows the
// modal's dark cyan theme (no mixed light/dark surfaces).
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, KeyRound, Loader2, Shield, ShieldCheck } from 'lucide-react';
import {
  listProviders,
  createProvider,
  setProviderCredential,
  deleteProvider,
  listModels,
  createModel,
  deleteModel,
} from '../../services/modelGatewayClient';
import type { ProviderDTO, ModelDTO } from '../../types/modelGateway';
import { fetchMe, SessionUser } from '../../services/authClient';
import { registerModel } from '../../services/modelRegistry';

const inputCls =
  'bg-slate-900/80 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-cyan-400/60 transition-colors';
const selectCls = `${inputCls} pr-6`;
const btnPrimary =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-300 text-slate-950 text-xs font-semibold hover:bg-cyan-200 transition-colors disabled:opacity-50';
const btnGhost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs hover:bg-white/10 transition-colors';
const btnDanger =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-xs hover:bg-rose-500/25 transition-colors';

const badge = (cls: string) =>
  `inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${cls}`;

const capBadge: Record<string, string> = {
  chat: 'bg-cyan-400/15 text-cyan-300',
  image: 'bg-amber-400/15 text-amber-300',
  video: 'bg-rose-400/15 text-rose-300',
};
const accessBadge: Record<string, string> = {
  verified: 'bg-emerald-400/15 text-emerald-300',
  vip: 'bg-amber-400/15 text-amber-300',
  admin: 'bg-rose-400/15 text-rose-300',
};

const defaultParams = (capability: string): any => {
  if (capability === 'chat') return { temperature: 0.7, maxTokens: 8192 };
  if (capability === 'image') return { size: '1280x720', defaultAspectRatio: '16:9' };
  return { duration: 8, defaultDuration: 8, mode: 'async', defaultAspectRatio: '16:9' };
};

export default function GatewayPanel() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pForm, setPForm] = useState({ name: '', baseUrl: '', authType: 'none' as any, authHeaderName: '', scope: 'private' as any });
  const [mForm, setMForm] = useState({
    providerId: '', name: '', apiModel: '', capability: 'chat' as any,
    adapterKind: 'gateway', protocolPreset: 'openai-chat', endpointPath: '/v1/chat/completions',
  });
  const [credentialFor, setCredentialFor] = useState<{ id: string; secret: string } | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const [ps, ms] = await Promise.all([listProviders(), listModels()]);
      setProviders(ps);
      setModels(ms);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe().then((u) => {
      setUser(u);
      if (u) refresh();
    });
  }, []);

  if (!user) return null;
  const isAdmin = user.role === 'admin';

  return (
    <div className="space-y-6 text-slate-200">
      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* ===== Providers ===== */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <Shield className="w-4 h-4 text-cyan-300" />
          <h4 className="text-sm font-bold text-cyan-100">服务商 Provider</h4>
          <span className="text-[10px] text-slate-500">服务端持凭证 · 浏览器不可见密钥</span>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
            </div>
          ) : providers.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">暂无服务商，在下方添加一个。</p>
          ) : (
            providers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-100">{p.name}</span>
                    <span className={badge(p.scope === 'shared' ? 'bg-violet-400/15 text-violet-300' : 'bg-sky-400/15 text-sky-300')}>
                      {p.scope === 'shared' ? '共享' : '私有'}
                    </span>
                    <span className={badge('bg-slate-400/10 text-slate-400')}>{p.authType}</span>
                    <span className={badge(p.credentialConfigured ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300')}>
                      {p.credentialConfigured ? '凭证已配置' : '未配置凭证'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{p.baseUrl}</p>
                </div>
                {(p.scope === 'private' || isAdmin) && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button className={btnGhost} onClick={() => setCredentialFor({ id: p.id, secret: '' })}>
                      <KeyRound className="w-3.5 h-3.5" />
                      密钥
                    </button>
                    <button
                      className={btnDanger}
                      onClick={async () => {
                        await deleteProvider(p.id);
                        refresh();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 添加服务商 */}
        <div className="mt-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold text-slate-400 mb-2">添加服务商</p>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputCls} flex-1 min-w-[100px]`} placeholder="名称" value={pForm.name}
              onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
            <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder="https://base-url" value={pForm.baseUrl}
              onChange={(e) => setPForm({ ...pForm, baseUrl: e.target.value })} />
            <select className={selectCls} value={pForm.authType}
              onChange={(e) => setPForm({ ...pForm, authType: e.target.value })}>
              <option value="none">无鉴权</option>
              <option value="bearer">Bearer Token</option>
              <option value="api-key-header">自定义 Header</option>
            </select>
            {pForm.authType === 'api-key-header' && (
              <input className={`${inputCls} w-28`} placeholder="Header 名" value={pForm.authHeaderName}
                onChange={(e) => setPForm({ ...pForm, authHeaderName: e.target.value })} />
            )}
            {isAdmin && (
              <select className={selectCls} value={pForm.scope}
                onChange={(e) => setPForm({ ...pForm, scope: e.target.value })}>
                <option value="private">私有</option>
                <option value="shared">共享</option>
              </select>
            )}
            <button
              className={btnPrimary}
              disabled={busy || !pForm.name || !pForm.baseUrl}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await createProvider(pForm);
                  setPForm({ name: '', baseUrl: '', authType: 'none', authHeaderName: '', scope: 'private' });
                  await refresh();
                } catch (e: any) {
                  setError(e?.message || '创建失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Plus className="w-3.5 h-3.5" /> 添加
            </button>
          </div>
        </div>

        {/* 设置凭证 */}
        {credentialFor && (
          <div className="mt-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 flex items-center gap-2">
            <input
              className={`${inputCls} flex-1`}
              type="password"
              placeholder="凭证密钥（仅存服务端加密）"
              value={credentialFor.secret}
              onChange={(e) => setCredentialFor({ ...credentialFor, secret: e.target.value })}
            />
            <button
              className={btnPrimary}
              disabled={!credentialFor.secret}
              onClick={async () => {
                await setProviderCredential(credentialFor.id, credentialFor.secret);
                setCredentialFor(null);
                refresh();
              }}
            >
              保存
            </button>
            <button className={btnGhost} onClick={() => setCredentialFor(null)}>取消</button>
          </div>
        )}
      </section>

      {/* ===== Models ===== */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <ShieldCheck className="w-4 h-4 text-cyan-300" />
          <h4 className="text-sm font-bold text-cyan-100">模型 Model</h4>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {loading ? (
            <p className="text-xs text-slate-500 py-3">加载中…</p>
          ) : models.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">暂无模型，在下方添加一个。</p>
          ) : (
            models.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-100">{m.name}</span>
                    <span className={badge(capBadge[m.capability])}>{m.capability}</span>
                    <span className={badge(m.providerScope === 'shared' ? 'bg-violet-400/15 text-violet-300' : 'bg-sky-400/15 text-sky-300')}>
                      {m.providerScope === 'shared' ? '共享' : '私有'}
                    </span>
                    <span className={badge(accessBadge[m.accessLevel] || accessBadge.verified)}>{m.accessLevel}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {m.apiModel} · {m.providerName}
                  </p>
                </div>
                {(m.providerScope === 'private' || isAdmin) && (
                  <button
                    className={`${btnDanger} shrink-0`}
                    onClick={async () => {
                      await deleteModel(m.id);
                      refresh();
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* 添加模型 */}
        <div className="mt-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold text-slate-400 mb-2">添加模型（创建后自动出现在模型列表可选）</p>
          <div className="flex flex-wrap gap-2">
            <select
              className={selectCls}
              value={mForm.providerId}
              onChange={(e) => setMForm({ ...mForm, providerId: e.target.value })}
            >
              <option value="">选择服务商</option>
              {providers.filter((p) => p.scope === 'private' || isAdmin).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input className={`${inputCls} w-24`} placeholder="显示名" value={mForm.name}
              onChange={(e) => setMForm({ ...mForm, name: e.target.value })} />
            <input className={`${inputCls} w-28`} placeholder="API 模型名" value={mForm.apiModel}
              onChange={(e) => setMForm({ ...mForm, apiModel: e.target.value })} />
            <select className={selectCls} value={mForm.capability}
              onChange={(e) => setMForm({ ...mForm, capability: e.target.value })}>
              <option value="chat">对话</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
            </select>
            <select className={selectCls} value={mForm.protocolPreset}
              onChange={(e) => setMForm({ ...mForm, protocolPreset: e.target.value })}>
              <option value="openai-chat">openai-chat</option>
              <option value="openai-image">openai-image</option>
              <option value="openai-video-sync">openai-video-sync</option>
              <option value="openai-video-async">openai-video-async</option>
            </select>
            <input className={`${inputCls} flex-1 min-w-[140px]`} placeholder="/v1/chat/completions" value={mForm.endpointPath}
              onChange={(e) => setMForm({ ...mForm, endpointPath: e.target.value })} />
            <button
              className={btnPrimary}
              disabled={busy || !mForm.providerId || !mForm.name || !mForm.apiModel}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const { id } = await createModel(mForm);
                  // 注册到本地 registry，供 Stage UI 选择；adapter_kind 路由到网关。
                  registerModel({
                    id,
                    providerId: 'gateway',
                    name: mForm.name,
                    apiModel: mForm.apiModel,
                    type: mForm.capability === 'chat' ? 'chat' : mForm.capability === 'image' ? 'image' : 'video',
                    isEnabled: true,
                    adapter_kind: 'gateway',
                    params: defaultParams(mForm.capability),
                  } as any);
                  setMForm({ ...mForm, name: '', apiModel: '' });
                  await refresh();
                } catch (e: any) {
                  setError(e?.message || '创建失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Plus className="w-3.5 h-3.5" /> 添加
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

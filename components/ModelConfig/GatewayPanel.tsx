// Gateway model management panel (stage-3 self-hosted models).
//
// 主线是「三步向导」：选服务商 → 填 API Key → 勾模型。
// 用户不填 base URL / 协议预设 / 端点路径——这些由服务端预设表
// （server/model-gateway/provider-presets.js）提供，避免填错导致 404。
// 自部署/私有端点仍可在「高级」里手工配置。
//
// Private providers are user-scoped; shared providers/models are admin-only.
// Credentials only ever show a configured/masked state.
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, KeyRound, Loader2, Shield, ShieldCheck, Sparkles, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  listProviders,
  createProvider,
  setProviderCredential,
  deleteProvider,
  listModels,
  createModel,
  deleteModel,
  listProviderPresets,
  discoverProviderModels,
} from '../../services/modelGatewayClient';
import type { ProviderDTO, ModelDTO, ProviderPresetDTO } from '../../types/modelGateway';
import { broadcastGatewayModelsChanged } from '../../services/gatewayModels';
import {
  connectProvider,
  addSelectedModels,
  buildModelCandidates,
  capabilityLabels,
  type ModelCandidate,
  type ProviderCapability,
} from '../../services/gatewaySetup';
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

/** 把网关策略错误码翻成用户能行动的中文（服务端只回英文 code）。 */
const friendlyError = (e: any): string => {
  const code = e?.code || '';
  if (code === 'VIP_REQUIRED') return '当前账号无法创建私有服务商（需要 VIP）；请联系管理员，或用管理员账号建共享服务商。';
  if (code === 'ADMIN_ONLY') return '共享服务商需要管理员权限，请改用私有，或联系管理员。';
  if (code === 'UPSTREAM_ERROR') return `调用服务商失败：${e?.message || ''}`;
  if (code === 'INVALID_PARAMS') return `参数不合法：${e?.message || ''}`;
  return e?.message || '操作失败';
};

export default function GatewayPanel() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [presets, setPresets] = useState<ProviderPresetDTO[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 向导状态：1 选服务商 → 2 填 Key → 3 勾模型
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<ProviderPresetDTO | null>(null);
  const [secret, setSecret] = useState('');
  const [scope, setScope] = useState<'private' | 'shared'>('private');
  const [providerId, setProviderId] = useState('');
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [chosen, setChosen] = useState<Record<string, ModelCandidate>>({});
  const [discoverState, setDiscoverState] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle');
  const [discoverError, setDiscoverError] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualCapability, setManualCapability] = useState<ProviderCapability>('chat');

  // 高级（手工端点）与凭据补填
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
      // 服务商/模型可能刚增删：失效统一缓存并广播，让各阶段选择器立即刷新
      broadcastGatewayModelsChanged();
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe().then(async (u) => {
      setUser(u);
      if (!u) return;
      setScope(u.role === 'admin' ? 'shared' : 'private');
      await refresh();
      try {
        setPresets(await listProviderPresets());
      } catch (e: any) {
        setError(e?.message || '服务商预设加载失败');
      }
    });
  }, []);

  if (!user) return null;
  const isAdmin = user.role === 'admin';

  const registerGateway = (m: ModelCandidate, id: string) => {
    // 兼容仍在读本地注册表的旧路径（modelService 的 chat/image 分支）
    registerModel({
      id,
      providerId: 'gateway',
      name: m.name,
      apiModel: m.apiModel,
      type: m.capability,
      isEnabled: true,
      adapter_kind: 'gateway',
      params: defaultParams(m.capability),
    } as any);
  };

  const resetWizard = () => {
    setStep(1);
    setSelected(null);
    setSecret('');
    setProviderId('');
    setCandidates([]);
    setChosen({});
    setDiscoverState('idle');
    setDiscoverError('');
    setManualModel('');
  };

  const loadCandidates = async (preset: ProviderPresetDTO, pid: string) => {
    setDiscoverState('loading');
    setDiscoverError('');
    try {
      const discovered = await discoverProviderModels(pid);
      const list = buildModelCandidates({ preset, discovered });
      setCandidates(list);
      setDiscoverState('ok');
      setChosen(Object.fromEntries(list.filter((c) => c.preselect).map((c) => [c.apiModel, c])));
    } catch (e: any) {
      // 拉取失败不是死路：回退到预设推荐模型，并允许手填（火山方舟等需接入点 ID）
      const list = buildModelCandidates({ preset, discovered: [] });
      setCandidates(list);
      setDiscoverState('failed');
      setDiscoverError(e?.message || '模型列表拉取失败');
      setChosen(Object.fromEntries(list.filter((c) => c.preselect).map((c) => [c.apiModel, c])));
    }
  };

  const handleConnect = async () => {
    if (!selected || !secret) return;
    setBusy(true);
    setError('');
    try {
      const { providerId: pid } = await connectProvider({ preset: selected, secret, scope });
      setProviderId(pid);
      setStep(3);
      await refresh();
      await loadCandidates(selected, pid);
    } catch (e: any) {
      // 服务商已建成、仅 Key 保存失败：提示可稍后补填，避免重复开通
      if (e?.providerId) {
        setError(`${e.message}（服务商已创建，可在下方列表中补填密钥）`);
        await refresh();
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    if (!selected || !providerId) return;
    const picked = Object.values(chosen);
    if (picked.length === 0) {
      setNotice('已跳过模型添加，可稍后在下方「模型」里补加。');
      resetWizard();
      await refresh();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created: string[] = [];
      for (const m of picked) {
        const { id } = await createModel({
          providerId,
          name: m.name || m.apiModel,
          apiModel: m.apiModel,
          capability: m.capability,
          adapterKind: 'gateway',
          protocolPreset: selected.capabilities[m.capability]!.protocolPreset,
          endpointPath: selected.capabilities[m.capability]!.endpointPath,
          ...(selected.capabilities[m.capability]!.baseUrlOverride
            ? { baseUrlOverride: selected.capabilities[m.capability]!.baseUrlOverride }
            : {}),
        } as any);
        registerGateway(m, id);
        created.push(id);
      }
      setNotice(`已接入「${selected.name}」，新增 ${created.length} 个模型。`);
      resetWizard();
      await refresh();
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleChosen = (c: ModelCandidate) => {
    setChosen((prev) => {
      const next = { ...prev };
      if (next[c.apiModel]) delete next[c.apiModel];
      else next[c.apiModel] = c;
      return next;
    });
  };

  const setCandidateCapability = (c: ModelCandidate, capability: ProviderCapability) => {
    const updated = { ...c, capability };
    setCandidates((prev) => prev.map((x) => (x.apiModel === c.apiModel ? updated : x)));
    setChosen((prev) => (prev[c.apiModel] ? { ...prev, [c.apiModel]: updated } : prev));
  };

  const supportsMultiCapability = selected ? Object.keys(selected.capabilities).length > 1 : false;
  const capabilityOptions = selected
    ? (Object.keys(selected.capabilities) as ProviderCapability[])
    : (['chat', 'image', 'video'] as ProviderCapability[]);

  return (
    <div className="space-y-6 text-slate-200">
      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {notice && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {notice}
        </div>
      )}

      {/* ===== 三步向导 ===== */}
      <section className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3.5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-cyan-300" />
          <h4 className="text-sm font-bold text-cyan-100">接入模型服务商</h4>
          <span className="text-[10px] text-slate-500">
            选服务商 → 填 API Key → 勾模型；接口地址与协议已内置，无需填写
          </span>
        </div>

        {/* Step 1: 选服务商 */}
        <div className="flex items-center gap-2 mb-2">
          <span className={badge(step >= 1 ? 'bg-cyan-400/20 text-cyan-200' : 'bg-slate-400/10 text-slate-500')}>1 选服务商</span>
          <span className={badge(step >= 2 ? 'bg-cyan-400/20 text-cyan-200' : 'bg-slate-400/10 text-slate-500')}>2 填 Key</span>
          <span className={badge(step >= 3 ? 'bg-cyan-400/20 text-cyan-200' : 'bg-slate-400/10 text-slate-500')}>3 勾模型</span>
        </div>

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.length === 0 && <p className="text-xs text-slate-500 py-2">预设加载中…</p>}
            {presets.map((p) => (
              <button
                key={p.key}
                className="text-left rounded-xl border border-white/10 bg-white/[0.03] hover:border-cyan-300/40 hover:bg-cyan-300/5 px-3 py-2 transition-colors"
                onClick={() => {
                  setSelected(p);
                  setSecret('');
                  setStep(2);
                }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-slate-100">{p.name}</span>
                  {(Object.keys(p.capabilities) as ProviderCapability[]).map((cap) => (
                    <span key={cap} className={badge(capBadge[cap])}>{capabilityLabels[cap]}</span>
                  ))}
                </div>
                {p.hint && <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{p.hint}</p>}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: 填 Key */}
        {step === 2 && selected && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-100">{selected.name}</span>
              <button className={btnGhost} onClick={() => { setSelected(null); setStep(1); }}>换一个</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} flex-1 min-w-[220px]`}
                type="password"
                placeholder="粘贴 API Key（仅保存在服务端加密存储）"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              {isAdmin && (
                <select className={selectCls} value={scope} onChange={(e) => setScope(e.target.value as any)}>
                  <option value="shared">共享（所有用户可用）</option>
                  <option value="private">私有（仅自己可用）</option>
                </select>
              )}
              <button className={btnPrimary} disabled={busy || !secret} onClick={handleConnect}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                连接并拉取模型
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              Key 不会经过浏览器发往第三方；调用由服务端代理，随时可在下方删除服务商撤销。
            </p>
          </div>
        )}

        {/* Step 3: 勾模型 */}
        {step === 3 && selected && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-100">{selected.name}</span>
              {discoverState === 'loading' && (
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在用你的 Key 拉取可用模型…
                </span>
              )}
              {discoverState === 'ok' && (
                <span className="text-[11px] text-emerald-300">已拉取 {candidates.length} 个模型</span>
              )}
              {discoverState === 'failed' && (
                <span className="text-[11px] text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> 拉取失败，已回退推荐模型：{discoverError}
                </span>
              )}
              <button
                className={btnGhost}
                disabled={discoverState === 'loading'}
                onClick={() => loadCandidates(selected, providerId)}
              >
                <RefreshCw className="w-3.5 h-3.5" /> 重新拉取
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {candidates.map((c) => (
                <label
                  key={c.apiModel}
                  className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 cursor-pointer"
                >
                  <input type="checkbox" checked={!!chosen[c.apiModel]} onChange={() => toggleChosen(c)} />
                  <span className="flex-1 min-w-0">
                    <span className="text-xs text-slate-100">{c.name}</span>
                    {c.name !== c.apiModel && <span className="text-[10px] text-slate-500 ml-1.5">{c.apiModel}</span>}
                  </span>
                  <span className={badge('bg-slate-400/10 text-slate-400')}>{c.source === 'preset' ? '推荐' : '拉取'}</span>
                  {supportsMultiCapability ? (
                    <select
                      className={selectCls}
                      value={c.capability}
                      onChange={(e) => setCandidateCapability(c, e.target.value as ProviderCapability)}
                    >
                      {capabilityOptions.map((cap) => (
                        <option key={cap} value={cap}>{capabilityLabels[cap]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={badge(capBadge[c.capability])}>{capabilityLabels[c.capability]}</span>
                  )}
                </label>
              ))}
              {candidates.length === 0 && discoverState !== 'loading' && (
                <p className="text-xs text-slate-500 py-2">
                  没有可自动发现的模型，请在下方手动填写模型名后添加。
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
              <input
                className={`${inputCls} flex-1 min-w-[180px]`}
                placeholder="手动添加模型名（火山方舟填接入点 ID，如 ep-2024…）"
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
              />
              <select className={selectCls} value={manualCapability} onChange={(e) => setManualCapability(e.target.value as ProviderCapability)}>
                {capabilityOptions.map((cap) => (
                  <option key={cap} value={cap}>{capabilityLabels[cap]}</option>
                ))}
              </select>
              <button
                className={btnGhost}
                disabled={!manualModel}
                onClick={() => {
                  const c: ModelCandidate = {
                    apiModel: manualModel.trim(), name: manualModel.trim(),
                    capability: manualCapability, preselect: true, source: 'discovered',
                  };
                  setCandidates((prev) => [...prev.filter((x) => x.apiModel !== c.apiModel), c]);
                  setChosen((prev) => ({ ...prev, [c.apiModel]: c }));
                  setManualModel('');
                }}
              >
                <Plus className="w-3.5 h-3.5" /> 加入列表
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button className={btnPrimary} disabled={busy} onClick={handleFinish}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                完成（已选 {Object.keys(chosen).length}）
              </button>
              <button className={btnGhost} disabled={busy} onClick={async () => { setNotice('已跳过模型添加。'); resetWizard(); await refresh(); }}>
                稍后再选
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ===== 已配置服务商 ===== */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <Shield className="w-4 h-4 text-cyan-300" />
          <h4 className="text-sm font-bold text-cyan-100">已接入的服务商</h4>
          <span className="text-[10px] text-slate-500">服务端持凭证 · 浏览器不可见密钥</span>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
            </div>
          ) : providers.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">还没有接入服务商，用上面的三步向导添加。</p>
          ) : (
            providers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-100">{p.name}</span>
                    <span className={badge(p.scope === 'shared' ? 'bg-violet-400/15 text-violet-300' : 'bg-sky-400/15 text-sky-300')}>
                      {p.scope === 'shared' ? '共享' : '私有'}
                    </span>
                    <span className={badge(p.credentialConfigured ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300')}>
                      {p.credentialConfigured ? 'Key 已配置' : '缺 Key'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{p.baseUrl}</p>
                </div>
                {(p.scope === 'private' || isAdmin) && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button className={btnGhost} onClick={() => setCredentialFor({ id: p.id, secret: '' })}>
                      <KeyRound className="w-3.5 h-3.5" />
                      {p.credentialConfigured ? '换 Key' : '补 Key'}
                    </button>
                    <button className={btnDanger} onClick={async () => { await deleteProvider(p.id); refresh(); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {credentialFor && (
          <div className="mt-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 flex items-center gap-2">
            <input
              className={`${inputCls} flex-1`}
              type="password"
              placeholder="API Key（仅存服务端加密）"
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

      {/* ===== 可用模型 ===== */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <ShieldCheck className="w-4 h-4 text-cyan-300" />
          <h4 className="text-sm font-bold text-cyan-100">可用模型</h4>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {loading ? (
            <p className="text-xs text-slate-500 py-3">加载中…</p>
          ) : models.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">暂无模型，用向导接入服务商后会自动出现。</p>
          ) : (
            models.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-100">{m.name}</span>
                    <span className={badge(capBadge[m.capability])}>{capabilityLabels[m.capability as ProviderCapability] || m.capability}</span>
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
                  <button className={`${btnDanger} shrink-0`} onClick={async () => { await deleteModel(m.id); refresh(); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* ===== 高级：自部署端点（默认折叠） ===== */}
      <details className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
        <summary className="text-xs font-semibold text-slate-400 cursor-pointer">
          高级：自部署 / 私有端点（需自行填写地址与协议）
        </summary>
        <div className="mt-3 space-y-3">
          <div>
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
                  setBusy(true); setError('');
                  try {
                    await createProvider(pForm);
                    setPForm({ name: '', baseUrl: '', authType: 'none', authHeaderName: '', scope: 'private' });
                    await refresh();
                  } catch (e: any) { setError(friendlyError(e)); } finally { setBusy(false); }
                }}
              >
                <Plus className="w-3.5 h-3.5" /> 添加
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-slate-400 mb-2">添加模型</p>
            <div className="flex flex-wrap gap-2">
              <select className={selectCls} value={mForm.providerId}
                onChange={(e) => setMForm({ ...mForm, providerId: e.target.value })}>
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
                <option value="ark-video-async">ark-video-async</option>
                <option value="dashscope-video-async">dashscope-video-async</option>
                <option value="minimax-video-async">minimax-video-async</option>
              </select>
              <input className={`${inputCls} flex-1 min-w-[140px]`} placeholder="/v1/chat/completions" value={mForm.endpointPath}
                onChange={(e) => setMForm({ ...mForm, endpointPath: e.target.value })} />
              <button
                className={btnPrimary}
                disabled={busy || !mForm.providerId || !mForm.name || !mForm.apiModel}
                onClick={async () => {
                  setBusy(true); setError('');
                  try {
                    const { id } = await createModel(mForm);
                    registerModel({
                      id,
                      providerId: 'gateway',
                      name: mForm.name,
                      apiModel: mForm.apiModel,
                      type: mForm.capability,
                      isEnabled: true,
                      adapter_kind: 'gateway',
                      params: defaultParams(mForm.capability),
                    } as any);
                    setMForm({ ...mForm, name: '', apiModel: '' });
                    await refresh();
                  } catch (e: any) { setError(friendlyError(e)); } finally { setBusy(false); }
                }}
              >
                <Plus className="w-3.5 h-3.5" /> 添加
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

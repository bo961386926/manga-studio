// 管理后台面板：运营概览 + 用户管理。复用现有 admin API；
// 敏感操作（VIP/禁用/注册开关）失败提示需要重新认证时，弹出密码确认后重试。
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Search, ShieldCheck, Users, Activity, FolderOpen, AlertCircle } from 'lucide-react';
import {
  AnnouncementRow,
  AdminUserRow,
  createAnnouncement,
  deleteAnnouncement,
  disableUser,
  getRegistrationOpen,
  getStatsOverview,
  grantVip,
  listAdminUsers,
  listAnnouncements,
  reauthenticate,
  revokeVip,
  setRegistrationOpen,
} from '../../services/adminClient';

const card = 'rounded-2xl border border-white/10 bg-slate-950/70 p-4';

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
  <div className={card}>
    <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-bold text-slate-100">{value}</div>
  </div>
);

const isReauthError = (e: any) => /reauth/i.test(String(e?.message || ''));

export default function AdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'overview' | 'users' | 'announcements'>('overview');
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annLevel, setAnnLevel] = useState<'info' | 'warning' | 'critical'>('info');
  const [annEndsAt, setAnnEndsAt] = useState('');
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [query, setQuery] = useState('');
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthPwd, setReauthPwd] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);

  const flash = (m: string) => {
    setMsg(m);
    setErr('');
    setTimeout(() => setMsg(''), 4000);
  };

  const loadOverview = useCallback(async () => {
    setStats(await getStatsOverview());
  }, []);

  const loadUsers = useCallback(async (q = '') => {
    setUsers(await listAdminUsers(q));
  }, []);

  const loadRegistration = useCallback(async () => {
    setRegOpen(await getRegistrationOpen());
  }, []);

  const loadAnnouncements = useCallback(async () => {
    setAnnouncements(await listAnnouncements());
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOverview().catch((e) => setErr(e.message)), loadUsers().catch((e) => setErr(e.message)), loadRegistration().catch(() => undefined), loadAnnouncements().catch(() => undefined)])
      .finally(() => setLoading(false));
  }, [loadOverview, loadUsers, loadRegistration, loadAnnouncements]);

  // 敏感操作统一入口：遇到「需要重新认证」则弹密码框后重试同一动作。
  const runSensitive = async (action: () => Promise<void>, okMsg: string) => {
    setErr('');
    try {
      await action();
      flash(okMsg);
      await Promise.all([loadUsers(query).catch(() => undefined), loadOverview().catch(() => undefined), loadAnnouncements().catch(() => undefined)]);
    } catch (e: any) {
      if (isReauthError(e)) {
        setPendingAction(() => action);
        setMsg('');
      } else {
        setErr(e?.message || '操作失败');
      }
    }
  };

  const doReauthenticate = async () => {
    setReauthBusy(true);
    setErr('');
    try {
      await reauthenticate(reauthPwd);
      const action = pendingAction;
      setPendingAction(null);
      setReauthPwd('');
      if (action) {
        await action();
        flash('操作成功');
        await Promise.all([loadUsers(query).catch(() => undefined), loadOverview().catch(() => undefined)]);
      }
    } catch (e: any) {
      setErr(e?.message === 'invalid password' ? '密码错误' : e?.message || '重新认证失败');
    } finally {
      setReauthBusy(false);
    }
  };

  const inputCls =
    'w-full bg-slate-900/70 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-slate-100 ' +
    'placeholder:text-slate-500 outline-none transition-all focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20';

  return (
    <div className="min-h-screen w-full font-sans text-slate-100 bg-[linear-gradient(135deg,_#07111f_0%,_#120b1f_48%,_#07130f_100%)]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-cyan-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回项目库
            </button>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-cyan-300" />
              管理后台
            </h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {(['overview', 'users', 'announcements'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-xl transition-colors ${
                  tab === t ? 'bg-cyan-300 text-slate-950 font-bold' : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                {t === 'overview' ? '运营概览' : t === 'users' ? '用户管理' : '公告管理'}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {err}
          </div>
        )}
        {msg && (
          <div className="mb-4 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 rounded-xl px-3 py-2">
            {msg}
          </div>
        )}

        {loading && <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> 加载中…</div>}

        {!loading && tab === 'overview' && stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard icon={<Users className="w-3.5 h-3.5" />} label="注册用户" value={stats.users_total} />
            <StatCard icon={<Users className="w-3.5 h-3.5" />} label="已验证用户" value={stats.users_verified} />
            <StatCard icon={<Users className="w-3.5 h-3.5" />} label="24h 新注册" value={stats.users_new_24h} />
            <StatCard icon={<FolderOpen className="w-3.5 h-3.5" />} label="项目总数" value={stats.projects_total} />
            <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="24h 模型调用" value={stats.invocations_24h} />
            <StatCard
              icon={<Activity className="w-3.5 h-3.5" />}
              label="24h 调用失败率"
              value={`${(stats.failure_rate_24h * 100).toFixed(1)}%`}
            />
            <div className={`${card} col-span-2 md:col-span-3 flex items-center justify-between`}>
              <div>
                <div className="text-sm font-semibold text-slate-200">开放注册</div>
                <div className="text-xs text-slate-500 mt-1">关闭后新用户无法注册（需重新认证后切换）</div>
              </div>
              <button
                onClick={() =>
                  runSensitive(async () => {
                    const next = !(regOpen ?? true);
                    await setRegistrationOpen(next);
                    setRegOpen(next);
                  }, regOpen ? '已关闭注册' : '已开放注册')
                }
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  regOpen ? 'bg-emerald-400/90 text-slate-950' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {regOpen ? '开放中' : '已关闭'}
              </button>
            </div>
          </div>
        )}

        {!loading && tab === 'announcements' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-200">发布公告</div>
              <input className={inputCls} placeholder="标题（必填，最多 200 字）" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} maxLength={200} />
              <textarea className={`${inputCls} min-h-[80px]`} placeholder="正文（必填）" value={annBody} onChange={(e) => setAnnBody(e.target.value)} />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <div className="flex gap-1">
                  {(['info', 'warning', 'critical'] as const).map((lv) => (
                    <button
                      key={lv}
                      onClick={() => setAnnLevel(lv)}
                      className={`px-3 py-1.5 rounded-lg border transition-colors ${
                        annLevel === lv
                          ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-200'
                          : 'border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {lv === 'info' ? 'ℹ️ 信息' : lv === 'warning' ? '⚠️ 警告' : '🚨 严重'}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2">
                  结束时间（可选）:
                  <input type="datetime-local" className="bg-slate-900/70 border border-slate-700/80 rounded-lg px-2 py-1" value={annEndsAt} onChange={(e) => setAnnEndsAt(e.target.value)} />
                </label>
                <button
                  className="px-4 py-2 rounded-xl bg-cyan-300 text-slate-950 text-xs font-bold hover:bg-cyan-200 transition-colors disabled:opacity-50 ml-auto"
                  disabled={!annTitle.trim() || !annBody.trim()}
                  onClick={() =>
                    runSensitive(async () => {
                      await createAnnouncement({
                        title: annTitle.trim(),
                        body: annBody.trim(),
                        level: annLevel,
                        endsAt: annEndsAt ? new Date(annEndsAt).toISOString() : null,
                      });
                      setAnnTitle('');
                      setAnnBody('');
                      setAnnLevel('info');
                      setAnnEndsAt('');
                      await loadAnnouncements();
                    }, '公告已发布')
                  }
                >
                  发布
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {announcements.map((a) => (
                <div key={a.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        a.level === 'critical'
                          ? 'text-rose-300 border-rose-400/30 bg-rose-400/10'
                          : a.level === 'warning'
                          ? 'text-amber-300 border-amber-400/30 bg-amber-400/10'
                          : 'text-cyan-300 border-cyan-400/30 bg-cyan-400/10'
                      }`}>
                        {a.level}
                      </span>
                      <span className="text-sm font-semibold text-slate-100 truncate">{a.title}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-all">{a.body}</p>
                    <div className="text-[11px] text-slate-600 mt-1">
                      {new Date(a.created_at).toLocaleString()}
                      {a.ends_at ? ` · 至 ${new Date(a.ends_at).toLocaleString()}` : ' · 长期有效'}
                    </div>
                  </div>
                  <button
                    className="text-xs px-2.5 py-1 rounded-lg border border-rose-400/30 text-rose-300 hover:bg-rose-400/10 transition-colors shrink-0"
                    onClick={() => {
                      if (window.confirm('确认删除该公告？')) {
                        runSensitive(() => deleteAnnouncement(a.id), '公告已删除');
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
              {announcements.length === 0 && <div className="text-center text-slate-500 text-sm py-6">还没有公告</div>}
            </div>
          </div>
        )}

        {!loading && tab === 'users' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="按邮箱搜索用户…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  loadUsers(e.target.value).catch(() => undefined);
                }}
              />
            </div>
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04] text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">邮箱</th>
                    <th className="text-left px-4 py-3">状态</th>
                    <th className="text-left px-4 py-3">角色</th>
                    <th className="text-left px-4 py-3">注册时间</th>
                    <th className="text-left px-4 py-3">最近登录</th>
                    <th className="text-right px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            u.status === 'active'
                              ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
                              : u.status === 'disabled'
                              ? 'text-rose-300 border-rose-400/30 bg-rose-400/10'
                              : 'text-amber-300 border-amber-400/30 bg-amber-400/10'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{u.role}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg border border-amber-400/30 text-amber-300 hover:bg-amber-400/10 transition-colors"
                          onClick={() =>
                            runSensitive(async () => {
                              await grantVip(u.id, new Date(Date.now() + 30 * 864e5).toISOString());
                            }, `已给 ${u.email} 发放 30 天 VIP`)
                          }
                        >
                          VIP 30天
                        </button>
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 hover:bg-white/5 transition-colors"
                          onClick={() => runSensitive(() => revokeVip(u.id), `已撤销 ${u.email} 的 VIP`)}
                        >
                          撤销VIP
                        </button>
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg border border-rose-400/30 text-rose-300 hover:bg-rose-400/10 transition-colors disabled:opacity-40"
                          disabled={u.status === 'disabled'}
                          onClick={() => {
                            if (window.confirm(`确认禁用 ${u.email}？其全部会话将被吊销。`)) {
                              runSensitive(() => disableUser(u.id), `已禁用 ${u.email}`);
                            }
                          }}
                        >
                          禁用
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                        没有匹配的用户
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 重新认证弹窗 */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100">需要重新认证</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              该操作属于敏感操作。请输入当前账号密码确认身份（确认后 15 分钟内无需重复输入）。
            </p>
            <input
              className={inputCls}
              type="password"
              placeholder="当前账号密码"
              value={reauthPwd}
              autoFocus
              onChange={(e) => setReauthPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doReauthenticate()}
            />
            {err && <div className="text-xs text-rose-300">{err}</div>}
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                onClick={() => {
                  setPendingAction(null);
                  setReauthPwd('');
                  setErr('');
                }}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-cyan-300 text-slate-950 text-sm font-bold hover:bg-cyan-200 transition-colors flex items-center gap-2 disabled:opacity-50"
                disabled={reauthBusy || !reauthPwd}
                onClick={doReauthenticate}
              >
                {reauthBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

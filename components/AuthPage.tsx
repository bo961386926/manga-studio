// Full-screen authentication page: login / register / password reset.
// Replaces the top-bar login banner so auth feels like a real page, with a
// smooth enter animation and consistent dark theme.
import React, { useEffect, useState } from 'react';
import { Clapperboard, Loader2, AlertCircle, CheckCircle2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { login, register, requestPasswordReset, verifyEmail, resetPassword, SessionUser } from '../services/authClient';

type Mode = 'login' | 'register' | 'reset' | 'verify' | 'reset-token';

const inputCls =
  'w-full bg-slate-900/70 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 outline-none transition-all focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20';

export default function AuthPage({ onAuthed }: { onAuthed: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionToken, setActionToken] = useState('');

  // 邮件操作链接直达：#/verify-email?token=… 自动验证；#/reset-password?token=… 进入设置新密码表单
  useEffect(() => {
    const hash = window.location.hash || '';
    const parseToken = (name: string) => {
      const m = hash.match(new RegExp(`^#/${name}\\?token=([A-Za-z0-9\\-_]+)`));
      return m ? m[1] : '';
    };
    const verifyToken = parseToken('verify-email');
    if (verifyToken) {
      setMode('verify');
      (async () => {
        try {
          await verifyEmail(verifyToken);
          setMsg('邮箱验证成功，请登录');
        } catch (e: any) {
          setErr(e?.message || '验证链接无效或已过期');
        } finally {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setMode('login');
        }
      })();
      return;
    }
    const resetToken = parseToken('reset-password');
    if (resetToken) {
      setActionToken(resetToken);
      setMode('reset-token');
    }
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr('');
    setMsg('');
  };

  const submit = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      if (mode === 'login') {
        const u = await login(email.trim(), password);
        onAuthed(u);
      } else if (mode === 'register') {
        if (password.length < 10) throw new Error('密码至少 10 位');
        if (password !== confirm) throw new Error('两次输入的密码不一致');
        await register(email.trim(), password);
        switchMode('login');
        setMsg('注册成功！验证链接已发送到你的邮箱，请查收并点击验证后登录');
      } else if (mode === 'reset-token') {
        if (password.length < 10) throw new Error('密码至少 10 位');
        if (password !== confirm) throw new Error('两次输入的密码不一致');
        await resetPassword(actionToken, password);
        switchMode('login');
        setMsg('密码已重置，请用新密码登录');
      } else {
        await requestPasswordReset(email.trim());
        setMsg('如果该邮箱已注册，重置链接已发送到你的邮箱');
      }
    } catch (e: any) {
      setErr(e?.message || '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 font-sans text-slate-100 selection:bg-cyan-400/25 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.18),_transparent_38%),linear-gradient(135deg,_#07111f_0%,_#120b1f_48%,_#07130f_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,_transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,_transparent_1px)] bg-[size:48px_48px] opacity-25" />

      <div className="relative w-full max-w-md animate-in zoom-in-95 fade-in duration-300">
        <div className="rounded-3xl border border-white/10 bg-slate-950/70 backdrop-blur-2xl shadow-2xl shadow-cyan-950/30 overflow-hidden">
          {/* 头部 */}
          <div className="px-8 pt-8 pb-6 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-300/10 border border-cyan-200/25 flex items-center justify-center mb-4">
              <Clapperboard className="w-7 h-7 text-cyan-300" />
            </div>
            <h1 className="text-xl font-bold tracking-wide">漫剧工场</h1>
            <p className="text-xs text-slate-500 mt-1 font-mono tracking-widest uppercase">
              {mode === 'login' ? '欢迎回来'
                : mode === 'register' ? '创建账号'
                : mode === 'verify' ? '验证邮箱'
                : mode === 'reset-token' ? '设置新密码'
                : '找回密码'}
            </p>
          </div>

          {/* 表单 */}
          <div className="px-8 pb-8 space-y-3.5">
            {mode === 'verify' ? (
              <div className="flex flex-col items-center gap-3 py-6 text-sm text-slate-300">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
                正在验证邮箱…
              </div>
            ) : mode !== 'reset' ? (
              <>
                <input
                  className={inputCls}
                  type="email"
                  placeholder="邮箱"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                <div className="relative">
                  <input
                    className={`${inputCls} pr-11`}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="密码"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-slate-500 hover:text-cyan-300 transition-colors"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {(mode === 'register' || mode === 'reset-token') && (
                  <div className="relative">
                    <input
                      className={`${inputCls} pr-11`}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="确认密码"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submit()}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 w-11 flex items-center justify-center text-slate-600">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </span>
                  </div>
                )}
                <button
                  onClick={submit}
                  disabled={busy}
                  className="w-full py-2.5 rounded-xl bg-cyan-300 text-slate-950 text-sm font-bold tracking-wide
                             hover:bg-cyan-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {mode === 'login' ? '登录' : mode === 'reset-token' ? '设置新密码' : '注册'}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400 leading-relaxed">
                  输入注册邮箱，我们会发送密码重置链接（开发环境链接见后端日志）。
                </p>
                <input
                  className={inputCls}
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                <button
                  onClick={submit}
                  disabled={busy}
                  className="w-full py-2.5 rounded-xl bg-cyan-300 text-slate-950 text-sm font-bold tracking-wide
                             hover:bg-cyan-200 active:scale-[0.98] transition-all disabled:opacity-50
                             flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  发送重置链接
                </button>
              </>
            )}

            {err && (
              <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl px-3 py-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {err}
              </div>
            )}
            {msg && (
              <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 rounded-xl px-3 py-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                {msg}
              </div>
            )}

            {/* 底部切换 */}
            <div className="flex items-center justify-center gap-4 pt-2 text-xs text-slate-400">
              {mode === 'login' ? (
                <>
                  <button className="hover:text-cyan-300 transition-colors" onClick={() => switchMode('register')}>
                    注册新账号
                  </button>
                  <span className="text-slate-700">·</span>
                  <button className="hover:text-cyan-300 transition-colors" onClick={() => switchMode('reset')}>
                    忘记密码
                  </button>
                </>
              ) : (
                <button
                  className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors"
                  onClick={() => switchMode('login')}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {mode === 'reset' ? '返回登录' : '已有账号，直接登录'}
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-600 mt-4 font-mono">
          MANGA STUDIO · AI 漫剧创作工作台
        </p>
      </div>
    </div>
  );
}

// Post-login migration/import assistant. Shown only to admins who still have
// legacy localStorage model config to migrate, or who want to import an old
// Electron export envelope. Styling follows the app's dark cyan theme.
import React, { useState } from 'react';
import { Database, Upload, Trash2, Loader2 } from 'lucide-react';
import { SessionUser } from '../services/authClient';
import {
  scanLegacyConfig,
  uploadLegacyConfig,
  deleteLegacyLocalConfig,
  LegacyMigrationSummary,
} from '../services/modelRegistry';
import { importRemoteEnvelope } from '../services/remoteMigration';

const chipCls =
  'fixed bottom-4 right-4 z-[90] w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl border border-cyan-200/20 ' +
  'bg-slate-950/90 backdrop-blur-xl shadow-2xl shadow-cyan-950/40 p-4 text-sm text-slate-200 animate-in slide-in-from-bottom-4 fade-in duration-300';

const btnPrimary =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-300 text-slate-950 text-xs font-bold hover:bg-cyan-200 transition-colors disabled:opacity-50';
const btnDanger =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/90 text-white text-xs font-bold hover:bg-rose-400 transition-colors';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs hover:bg-white/10 transition-colors';
const inputCls =
  'bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400/60';

export default function MigrationWizard({ user }: { user: SessionUser }) {
  const [summary] = useState<LegacyMigrationSummary>(() => scanLegacyConfig());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [done, setDone] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [importMsg, setImportMsg] = useState('');

  // 迁移需要管理员；普通用户不展示。
  if (user.role !== 'admin') return null;

  const hasLocal = summary.present && !done && !uploaded;
  const hasSomething = hasLocal || showImport;

  const doImport = async () => {
    if (!importFile) return;
    setBusy(true);
    setError('');
    setImportMsg('');
    try {
      const text = await importFile.text();
      const envelope = JSON.parse(text);
      const { refreshCsrf } = await import('../services/authClient');
      await refreshCsrf();
      await importRemoteEnvelope(envelope, importPassword, window.location.hostname || 'web');
      setImportMsg('迁移包导入成功');
      setImportFile(null);
      setImportPassword('');
    } catch (e: any) {
      setImportMsg(`导入失败: ${e?.message || '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={chipCls}>
      {hasLocal ? (
        <>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-300/10 border border-cyan-200/20 flex items-center justify-center shrink-0">
              <Database className="w-4.5 h-4.5 text-cyan-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-cyan-100">检测到旧版本地模型配置</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                模型 {summary.modelCount} 个 · 服务商 {summary.providerCount} 个
                {summary.apiKeyMasked ? ` · 密钥 ${summary.apiKeyMasked}` : ''}
                {summary.modelConfigPresent ? ' · 模型参数' : ''}
              </p>
              {error && <p className="text-xs text-rose-300 mt-1">{error}</p>}
              <div className="flex items-center gap-2 mt-3">
                {!uploaded ? (
                  <button
                    className={btnPrimary}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const { refreshCsrf } = await import('../services/authClient');
                        await refreshCsrf();
                        await uploadLegacyConfig(summary);
                        setUploaded(true);
                      } catch (e: any) {
                        setError(e?.message || '上传失败');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    确认迁移到云端
                  </button>
                ) : !confirmDelete ? (
                  <button className={btnDanger} onClick={() => setConfirmDelete(true)}>
                    服务端已保存，删除本地旧配置
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-amber-300">确认删除本地旧配置？</span>
                    <button
                      className={btnDanger}
                      onClick={() => {
                        deleteLegacyLocalConfig();
                        setDone(true);
                        setShowImport(false);
                      }}
                    >
                      确认删除
                    </button>
                    <button className={btnGhost} onClick={() => setConfirmDelete(false)}>
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      ) : showImport ? (
        <>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-300/10 border border-violet-200/20 flex items-center justify-center shrink-0">
              <Upload className="w-4.5 h-4.5 text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-violet-100">导入旧版迁移包</p>
              <p className="text-xs text-slate-400 mt-0.5">选择旧版 Electron 导出的 JSON 迁移包并输入导出密码。</p>
              <div className="flex flex-col gap-2 mt-2.5">
                <input
                  type="file"
                  accept=".json,application/json"
                  className="text-xs text-slate-400 file:mr-2 file:px-2.5 file:py-1 file:rounded-md file:border-0 file:bg-white/10 file:text-slate-200 file:text-xs file:cursor-pointer"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
                <input
                  className={inputCls}
                  type="password"
                  placeholder="迁移包密码"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                />
              </div>
              {importMsg && (
                <p className={`text-xs mt-2 ${importMsg.startsWith('导入失败') ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {importMsg}
                </p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button className={btnPrimary} disabled={busy || !importFile} onClick={doImport}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  导入
                </button>
                <button className={btnGhost} onClick={() => setShowImport(false)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 flex-1">已登录管理员</span>
          <button className={btnGhost} onClick={() => setShowImport(true)}>
            <Upload className="w-3.5 h-3.5" />
            导入旧版迁移包
          </button>
        </div>
      )}
    </div>
  );
}

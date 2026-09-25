// 站内通知铃铛：未读徽标 + 下拉通知面板（单条已读 / 全部已读）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';

interface NotificationItem {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  vip_expiring: '会员到期提醒',
  job_done: '任务完成',
  job_failed: '任务失败',
  system: '系统通知',
};

const KIND_STYLE: Record<string, string> = {
  job_done: 'text-emerald-300',
  job_failed: 'text-rose-300',
  vip_expiring: 'text-amber-300',
  system: 'text-cyan-300',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const d = await res.json();
        setItems(d.notifications || []);
        setUnread(d.unread || 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    load();
  };

  const markAll = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    load();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative w-full flex items-center justify-between px-4 py-3 text-[11px] font-medium tracking-widest uppercase border border-white/10 text-slate-400 hover:text-white hover:border-cyan-300/30 hover:bg-white/5 transition-colors rounded-2xl"
        aria-label="站内通知"
      >
        <span className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" />
          通知
        </span>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-2 w-80 max-w-[85vw] rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-xs font-bold text-slate-200">通知中心</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="text-[11px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1"
              >
                <CheckCheck className="w-3 h-3" />
                全部已读
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-slate-500">加载中…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-slate-500">暂无通知</div>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read_at && markRead(n.id)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.04] transition-colors ${
                  n.read_at ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold ${KIND_STYLE[n.kind] || 'text-cyan-300'}`}>
                    {KIND_LABEL[n.kind] || n.kind}
                  </span>
                  {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {n.kind === 'vip_expiring' && n.payload?.expiresAt
                    ? `你的 VIP 将于 ${new Date(String(n.payload.expiresAt)).toLocaleString()} 到期`
                    : n.kind === 'job_done'
                    ? '一个视频生成任务已完成'
                    : n.kind === 'job_failed'
                    ? '一个视频生成任务失败，可到渲染日志查看原因'
                    : '—'}
                </p>
                <div className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

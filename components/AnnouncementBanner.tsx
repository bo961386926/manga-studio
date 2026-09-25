// 顶部公告横幅：读取生效中的公告，按 level 着色；critical 不可关闭。
import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';

interface Announcement {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
}

const LEVEL_STYLE: Record<string, string> = {
  info: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  critical: 'border-rose-400/40 bg-rose-500/15 text-rose-100',
};

const LEVEL_LABEL: Record<string, string> = { info: '公告', warning: '注意', critical: '重要' };

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/announcements/active')
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => setItems(d.announcements || []))
      .catch(() => undefined);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {items.map((a, i) => {
        const key = `${a.title}-${i}`;
        if (dismissed.has(key)) return null;
        return (
          <div
            key={key}
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${LEVEL_STYLE[a.level] || LEVEL_STYLE.info}`}
          >
            <Megaphone className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold mr-2">【{LEVEL_LABEL[a.level] || '公告'}】</span>
              <span className="text-sm font-semibold">{a.title}</span>
              <p className="text-xs mt-0.5 opacity-90 whitespace-pre-wrap break-all">{a.body}</p>
            </div>
            {a.level !== 'critical' && (
              <button
                onClick={() => setDismissed((s) => new Set(s).add(key))}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="关闭公告"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

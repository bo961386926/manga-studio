-- 004: 公告系统 + 站内通知中心（stage-5）
-- 公告由管理员发布，登录用户可见（含未开始的不展示）；
-- 通知按用户隔离，读取状态由 read_at 标记。

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  level VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON announcements (starts_at, ends_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('vip_expiring', 'job_done', 'job_failed', 'system')),
  payload JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON notifications (user_id, kind, created_at DESC);

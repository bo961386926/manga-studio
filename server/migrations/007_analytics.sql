-- 极简埋点事件表（审计方案 §8：注册→验证→建项目→首次生成→付费，不做重型方案）。
-- 事件写入是 best-effort（fail-open），经营漏斗以核心表为准，本表仅作补充信号。
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event VARCHAR(64) NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analytics_events_user_created_idx ON analytics_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON analytics_events (event, created_at DESC);

-- 支付订单（B 阶段：支付闭环 MVP）
-- 通道抽象：manual（转账+管理员确认）先行；alipay_qr/wechat_native/stripe 预留。
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(32) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  sku_code VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  kind VARCHAR(16) NOT NULL,                    -- credits | vip
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  payload JSONB NOT NULL DEFAULT '{}',          -- 入账参数快照（credits 数 / vip 天数）
  channel VARCHAR(24) NOT NULL DEFAULT 'manual',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',-- pending|paid|cancelled|expired|refunded
  provider_ref VARCHAR(128),
  paid_at TIMESTAMPTZ,
  paid_by_admin UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_pending ON payment_orders(created_at) WHERE status = 'pending';

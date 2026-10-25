-- 005: 积分账户与流水（stage-6a/6b 免费增长期）
-- balance 永不为负；ledger 只增不改，是余额争议的唯一事实源。
-- 存量用户回填注册赠送（默认 200 分）。

CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  low_threshold INT NOT NULL DEFAULT 50,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  delta INT NOT NULL,
  balance_after INT NOT NULL,
  reason VARCHAR(32) NOT NULL CHECK (reason IN
    ('signup_grant', 'admin_grant', 'redeem', 'checkin', 'referral', 'invocation', 'refund', 'revoke')),
  ref_type VARCHAR(32),
  ref_id UUID,
  note VARCHAR(200),
  idempotency_key VARCHAR(80) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user
  ON credit_ledger (user_id, created_at DESC);

-- 存量用户回填注册赠送
INSERT INTO credit_accounts (user_id, balance)
SELECT id, 200 FROM users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
SELECT id, 200, 200, 'signup_grant', 'account', id, 'signup:' || id::text
FROM users
ON CONFLICT (idempotency_key) DO NOTHING;

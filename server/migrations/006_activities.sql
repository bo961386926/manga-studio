-- 006: 活动系统（stage-6c）：每日签到、兑换码、拉新邀请。

CREATE TABLE IF NOT EXISTS check_ins (
  user_id UUID NOT NULL REFERENCES users(id),
  checkin_date DATE NOT NULL,
  streak INT NOT NULL DEFAULT 1,
  credits_awarded INT NOT NULL,
  idempotency_key VARCHAR(80) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS redeem_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  credits INT NOT NULL CHECK (credits > 0),
  total_codes INT NOT NULL CHECK (total_codes > 0),
  max_redemptions_per_user INT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 券码只存哈希：明文仅在生成时一次性返回给运营
CREATE TABLE IF NOT EXISTS redeem_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES redeem_batches(id),
  code_hash BYTEA NOT NULL UNIQUE,
  redeemed_by UUID REFERENCES users(id),
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_open
  ON redeem_codes (batch_id) WHERE redeemed_by IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE;

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  referee_id UUID NOT NULL UNIQUE REFERENCES users(id),
  referrer_rewarded_at TIMESTAMPTZ,
  referee_rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

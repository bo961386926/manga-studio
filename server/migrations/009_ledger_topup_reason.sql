-- 支付订单入账需要新的 ledger reason 值（005 的 CHECK 白名单没有支付类）。
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
  CHECK (reason IN
    ('signup_grant', 'admin_grant', 'redeem', 'checkin', 'referral', 'invocation', 'refund', 'revoke', 'topup'));

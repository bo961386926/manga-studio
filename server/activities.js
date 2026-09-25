// 活动系统（stage-6c）：每日签到、兑换码核销、拉新邀请。
// 奖励参数经 system_settings 热调：
//   checkin_base_credits(默认 2) / checkin_max_credits(默认 10)
//   referral_referee_credits(默认 100) / referral_referrer_credits(默认 200)
// 所有入账经 credit_ledger 幂等键去重，重放天然安全。
import crypto from 'node:crypto';
import { pool, withTransaction } from './db.js';
import { getSystemSetting } from './repositories/settings.js';
import { PolicyError } from './model-gateway/policy.js';

const settingsNum = async (key, fallback) => {
  try {
    const v = await getSystemSetting(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

// 幂等入账：先查 ledger 唯一键，已存在则跳过（避免余额重复累加）。
export const grantCredits = async (client, { userId, amount, reason, refType = null, refId = null, note = null, idempotencyKey }) => {
  if (amount <= 0) return null;
  const dup = await client.query('SELECT 1 FROM credit_ledger WHERE idempotency_key = $1', [idempotencyKey]);
  if (dup.rows.length) return null;
  await client.query(
    'INSERT INTO credit_accounts (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
  const { rows } = await client.query(
    'UPDATE credit_accounts SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance',
    [userId, amount]
  );
  const balanceAfter = rows[0].balance;
  await client.query(
    `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, note, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, amount, balanceAfter, reason, refType, refId, note, idempotencyKey]
  );
  return balanceAfter;
};

// ---------- 每日签到 ----------

export const checkIn = async (userId) => {
  const base = await settingsNum('checkin_base_credits', 2);
  const max = await settingsNum('checkin_max_credits', 10);
  return withTransaction(async (client) => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `ck:${userId}:${today}`;
    const dup = await client.query('SELECT 1 FROM check_ins WHERE idempotency_key = $1', [key]);
    if (dup.rows.length) {
      throw new PolicyError('ALREADY_CHECKED_IN', '今天已经签到过了，明天再来', 409);
    }
    const yest = await client.query(
      'SELECT streak FROM check_ins WHERE user_id = $1 AND checkin_date = CURRENT_DATE - 1',
      [userId]
    );
    const streak = (yest.rows[0]?.streak || 0) + 1;
    const award = Math.min(base + streak - 1, max);
    await client.query(
      `INSERT INTO check_ins (user_id, checkin_date, streak, credits_awarded, idempotency_key)
       VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
      [userId, streak, award, key]
    );
    const balanceAfter = await grantCredits(client, {
      userId,
      amount: award,
      reason: 'checkin',
      refType: 'checkin',
      refId: null,
      note: `连续签到 ${streak} 天`,
      idempotencyKey: key,
    });
    return { date: today, streak, creditsAwarded: award, balance: balanceAfter };
  });
};

// ---------- 兑换码 ----------

export const redeemCode = async (userId, rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new PolicyError('INVALID_PARAMS', '请输入兑换码', 422);
  const hash = crypto.createHash('sha256').update(code).digest();
  return withTransaction(async (client) => {
    const { rows: [c] } = await client.query(
      `SELECT rc.id, rc.redeemed_by, rb.credits, rb.expires_at, rb.max_redemptions_per_user, rb.id AS batch_id
       FROM redeem_codes rc
       JOIN redeem_batches rb ON rb.id = rc.batch_id
       WHERE rc.code_hash = $1
       FOR UPDATE OF rc`,
      [hash]
    );
    if (!c) throw new PolicyError('REDEEM_INVALID', '兑换码无效', 404);
    if (c.redeemed_by) throw new PolicyError('REDEEM_USED', '兑换码已被使用', 409);
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      throw new PolicyError('REDEEM_EXPIRED', '兑换码已过期', 410);
    }
    const { rows: [cnt] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM redeem_codes WHERE batch_id = $1 AND redeemed_by = $2',
      [c.batch_id, userId]
    );
    if (cnt.n >= c.max_redemptions_per_user) {
      throw new PolicyError('REDEEM_LIMIT', '你已达到该批次兑换码的使用上限', 409);
    }
    await client.query('UPDATE redeem_codes SET redeemed_by = $2, redeemed_at = NOW() WHERE id = $1', [
      c.id,
      userId,
    ]);
    const balanceAfter = await grantCredits(client, {
      userId,
      amount: c.credits,
      reason: 'redeem',
      refType: 'redeem_code',
      refId: c.id,
      idempotencyKey: `rc:${c.id}`,
    });
    return { credits: c.credits, balance: balanceAfter };
  });
};

// ---------- 拉新邀请 ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const getOrCreateReferralCode = async (userId) => {
  const { rows } = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (rows[0]?.referral_code) return rows[0].referral_code;
  for (let i = 0; i < 5; i++) {
    const code = Array.from(crypto.randomBytes(8))
      .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
      .join('')
      .slice(0, 8);
    const { rowCount } = await pool.query(
      'UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL',
      [userId, code]
    );
    if (rowCount) return code;
  }
  const { rows: [r] } = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  return r.referral_code;
};

// 注册时绑定邀请关系（register 事务内调用；无效码静默忽略，不打断注册）。
export const bindReferral = async (client, refereeId, referralCode) => {
  const code = String(referralCode || '').trim().toUpperCase();
  if (!code) return null;
  const { rows: [ref] } = await client.query(
    'SELECT id FROM users WHERE referral_code = $1',
    [code]
  );
  if (!ref || ref.id === refereeId) return null;
  await client.query(
    `INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)
     ON CONFLICT (referee_id) DO NOTHING`,
    [ref.id, refereeId]
  );
  return ref.id;
};

// 被邀人邮箱验证通过 → 立即发放被邀人奖励（verify-email 事务内调用）。
export const rewardRefereeOnVerify = async (client, userId) => {
  const { rows } = await client.query(
    'SELECT id FROM referrals WHERE referee_id = $1 AND referee_rewarded_at IS NULL FOR UPDATE',
    [userId]
  );
  if (!rows.length) return;
  const amount = await settingsNum('referral_referee_credits', 100);
  const balanceAfter = await grantCredits(client, {
    userId,
    amount,
    reason: 'referral',
    refType: 'referral',
    refId: rows[0].id,
    idempotencyKey: `ref:${rows[0].id}:e`,
  });
  if (balanceAfter !== null) {
    await client.query('UPDATE referrals SET referee_rewarded_at = NOW() WHERE id = $1', [rows[0].id]);
  }
};

// 被邀人首次成功 AI 调用 → 发放邀请人奖励（invokeSync 成功事务内调用）。
export const rewardReferrerOnFirstSuccess = async (client, userId) => {
  const { rows } = await client.query(
    'SELECT id, referrer_id FROM referrals WHERE referee_id = $1 AND referrer_rewarded_at IS NULL FOR UPDATE',
    [userId]
  );
  if (!rows.length) return;
  const { rows: [cnt] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM model_invocations
     WHERE user_id = $1 AND status = 'succeeded'`,
    [userId]
  );
  if (cnt.n !== 1) return; // 仅首次成功
  const amount = await settingsNum('referral_referrer_credits', 200);
  const balanceAfter = await grantCredits(client, {
    userId: rows[0].referrer_id,
    amount,
    reason: 'referral',
    refType: 'referral',
    refId: rows[0].id,
    idempotencyKey: `ref:${rows[0].id}:r`,
  });
  if (balanceAfter !== null) {
    await client.query('UPDATE referrals SET referrer_rewarded_at = NOW() WHERE id = $1', [rows[0].id]);
  }
};

export const getReferralInfo = async (userId) => {
  const code = await getOrCreateReferralCode(userId);
  const { rows: invited } = await pool.query(
    `SELECT LEFT(u.email, 3) || '***' || SPLIT_PART(u.email, '@', 2) AS masked_email,
            r.referee_rewarded_at, r.referrer_rewarded_at, r.created_at
     FROM referrals r JOIN users u ON u.id = r.referee_id
     WHERE r.referrer_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
    [userId]
  );
  const refereeAmount = await settingsNum('referral_referee_credits', 100);
  const referrerAmount = await settingsNum('referral_referrer_credits', 200);
  return { code, invited, refereeAmount, referrerAmount };
};

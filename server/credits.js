// 积分计量与扣减（stage-6a/6b）。价格与配额可通过 system_settings 热调：
//   credit_price  → JSON {chat, image, video}（每次调用消耗的积分）
//   signup_grant_credits → 注册赠送积分（默认 200）
//   quota_<tier>_<capability> → 每日次数上限（如 quota_free_video = 3）
// 扣减与 invocation 同事务；ledger 幂等键防止重放双扣。
import { pool } from './db.js';
import { getSystemSetting } from './repositories/settings.js';
import { PolicyError } from './model-gateway/policy.js';

export const DEFAULT_PRICES = { chat: 1, image: 2, video: 30 };
export const SIGNUP_GRANT = 200;

const DAILY_QUOTA_DEFAULTS = {
  free: { chat: 10, image: 3, video: 3 },
  vip: { chat: 100, image: 30, video: 20 },
};

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

export const creditCost = async (client, operation) => {
  if (!DEFAULT_PRICES[operation]) return 0;
  try {
    const override = await getSystemSetting('credit_price');
    if (override && typeof override === 'object') {
      return num(override[operation], DEFAULT_PRICES[operation]);
    }
  } catch {
    // 配置读取失败按默认价
  }
  return DEFAULT_PRICES[operation];
};

// 懒创建账户：首次使用即赠送注册积分（幂等：ledger 唯一键去重）。
export const ensureCreditAccount = async (client, userId) => {
  const grant = await (async () => {
    try {
      const v = await getSystemSetting('signup_grant_credits');
      return num(v, SIGNUP_GRANT);
    } catch {
      return SIGNUP_GRANT;
    }
  })();
  const { rows } = await client.query(
    `INSERT INTO credit_accounts (user_id, balance) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING balance`,
    [userId, grant]
  );
  if (rows[0]) {
    await client.query(
      `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
       VALUES ($1, $2, $2, 'signup_grant', 'account', $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, grant, userId, `signup:${userId}`]
    );
    return grant;
  }
  const { rows: [row] } = await client.query(
    'SELECT balance FROM credit_accounts WHERE user_id = $1',
    [userId]
  );
  return row?.balance ?? 0;
};

// 扣减（调用方须在事务内、且已 FOR UPDATE 行锁或刚插入 invocation）。
export const deductCredits = async (client, { userId, cost, refId, reason = 'invocation' }) => {
  if (cost <= 0) return null;
  await ensureCreditAccount(client, userId);
  const { rows } = await client.query(
    'SELECT balance FROM credit_accounts WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  const balance = rows[0]?.balance ?? 0;
  if (balance < cost) {
    throw new PolicyError('CREDIT_REQUIRED', `积分不足：本次调用需要 ${cost} 分，当前余额 ${balance}`, 402);
  }
  const { rows: updated } = await client.query(
    `UPDATE credit_accounts SET balance = balance - $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance`,
    [userId, cost]
  );
  const balanceAfter = updated[0].balance;
  await client.query(
    `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
     VALUES ($1, $2, $3, $4, 'invocation', $5, $6)`,
    [userId, -cost, balanceAfter, reason, refId, `inv:${refId}`]
  );
  return balanceAfter;
};

export const refundCredits = async (client, { userId, cost, refId }) => {
  if (cost <= 0) return null;
  await ensureCreditAccount(client, userId);
  const { rows: updated } = await client.query(
    `UPDATE credit_accounts SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance`,
    [userId, cost]
  );
  const balanceAfter = updated[0].balance;
  await client.query(
    `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
     VALUES ($1, $2, $3, 'refund', 'invocation', $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, cost, balanceAfter, refId, `refund:${refId}`]
  );
  return balanceAfter;
};

export const getBalance = async (userId) => {
  const { rows } = await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [userId]);
  return rows[0]?.balance ?? 0;
};

const isVipUser = async (userId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_entitlements
     WHERE user_id = $1 AND entitlement_key = 'vip' AND enabled = TRUE
       AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
};

const quotaFor = async (tier, capability) => {
  try {
    const override = await getSystemSetting(`quota_${tier}_${capability}`);
    const fallback = DAILY_QUOTA_DEFAULTS[tier]?.[capability];
    return num(typeof override === 'number' ? override : undefined, fallback ?? 0);
  } catch {
    return DAILY_QUOTA_DEFAULTS[tier]?.[capability] ?? 0;
  }
};

// 每日配额护栏：免费/会员分档，管理员不受限。
export const assertDailyQuota = async ({ userId, capability, isAdmin }) => {
  if (isAdmin || !DAILY_QUOTA_DEFAULTS.free[capability]) return;
  const tier = (await isVipUser(userId)) ? 'vip' : 'free';
  const limit = await quotaFor(tier, capability);
  if (limit <= 0) {
    throw new PolicyError('QUOTA_EXCEEDED', `${capabilityLabel(capability)}对当前账户不可用，请升级会员`, 429);
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM model_invocations
     WHERE user_id = $1 AND operation = $2 AND created_at >= date_trunc('day', NOW())`,
    [userId, capability]
  );
  if (rows[0].c >= limit) {
    throw new PolicyError(
      'QUOTA_EXCEEDED',
      `今日${capabilityLabel(capability)}次数已达上限（${limit} 次/天），明天再来或升级会员`,
      429
    );
  }
};

const capabilityLabel = (capability) =>
  ({ chat: '文本生成', image: '图片生成', video: '视频生成' }[capability] || capability);

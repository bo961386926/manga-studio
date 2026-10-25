// 支付通道抽象 + 订单服务（B 阶段 MVP）。
// 通道只需实现 createPayment(order) → { payUrl?|instructions? }；
// 入账统一走 confirmOrder（事务 + 幂等），与通道无关。
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { topupCredits } from '../credits.js';
import { grantVip } from '../auth/entitlements.js';
import { resolveSku } from './skus.js';
import { trackEvent } from '../analytics.js';

// ---------- 通道注册表 ----------
// manual：无需商户资质。用户按页面说明转账（备注订单号），管理员核对凭证后确认到账。
// alipay_qr / wechat_native / stripe：预留适配位，实现 createPayment 后即可上线。
const MANUAL_ACCOUNT = process.env.PAY_MANUAL_ACCOUNT || '（管理员未配置 PAY_MANUAL_ACCOUNT，请在后台填写收款说明）';

const channels = {
  manual: {
    key: 'manual',
    label: '人工转账确认',
    createPayment: () => ({
      mode: 'manual',
      instructions: `请向「${MANUAL_ACCOUNT}」转账对应金额，并在备注中填写订单号；管理员核对到账后点击确认，积分/会员自动入账。`,
    }),
  },
  alipay_qr: { key: 'alipay_qr', label: '支付宝（未接入）', createPayment: () => { throw Object.assign(new Error('通道未配置'), { code: 'CHANNEL_NOT_CONFIGURED' }); } },
  wechat_native: { key: 'wechat_native', label: '微信支付（未接入）', createPayment: () => { throw Object.assign(new Error('通道未配置'), { code: 'CHANNEL_NOT_CONFIGURED' }); } },
  stripe: { key: 'stripe', label: 'Stripe（未接入）', createPayment: () => { throw Object.assign(new Error('通道未配置'), { code: 'CHANNEL_NOT_CONFIGURED' }); } },
};

export const getChannel = (key) => channels[key] || null;
export const listChannels = () => Object.values(channels).map(({ key, label }) => ({ key, label }));

// ---------- 订单 ----------
const genOrderNo = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `MS${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

export const createOrder = async ({ userId, skuCode, channel }) => {
  const sku = resolveSku(skuCode);
  if (!sku) throw Object.assign(new Error('未知商品'), { code: 'UNKNOWN_SKU' });
  const ch = getChannel(channel);
  if (!ch) throw Object.assign(new Error('未知支付通道'), { code: 'UNKNOWN_CHANNEL' });

  const orderNo = genOrderNo();
  const { rows } = await pool.query(
    `INSERT INTO payment_orders (order_no, user_id, sku_code, title, kind, amount_cents, payload, channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [orderNo, userId, skuCode, sku.title, sku.kind, sku.amountCents, JSON.stringify(sku.payload), channel]
  );
  const pay = ch.createPayment({ order: rows[0], sku });
  return { order: rows[0], pay };
};

export const getUserOrders = async ({ userId, limit = 20 }) => {
  const { rows } = await pool.query(
    `SELECT order_no, sku_code, title, kind, amount_cents, currency, channel, status, provider_ref, paid_at, created_at
     FROM payment_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
};

export const getOrderByNo = async (orderNo) => {
  const { rows } = await pool.query(`SELECT * FROM payment_orders WHERE order_no = $1`, [orderNo]);
  return rows[0] || null;
};

export const cancelOrder = async ({ userId, orderNo }) => {
  const { rows } = await pool.query(
    `UPDATE payment_orders SET status='cancelled', updated_at=NOW()
     WHERE order_no=$1 AND user_id=$2 AND status='pending' RETURNING *`,
    [orderNo, userId]
  );
  if (!rows[0]) throw Object.assign(new Error('订单不可取消（不存在/非本人/非待支付）'), { code: 'NOT_CANCELLABLE' });
  return rows[0];
};

// ---------- 确认入账（与通道无关，事务 + 幂等）----------
export const confirmOrder = async ({ orderNo, adminId, providerRef = null }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 原子占位：只有 pending → paid 的那条更新会拿到行；并发/重复确认在此收敛。
    const { rows } = await client.query(
      `UPDATE payment_orders SET status='paid', paid_at=NOW(), paid_by_admin=$2,
              provider_ref=COALESCE($3, provider_ref), updated_at=NOW()
       WHERE order_no=$1 AND status='pending' RETURNING *`,
      [orderNo, adminId, providerRef]
    );
    const order = rows[0];
    if (!order) throw Object.assign(new Error('订单不可确认（不存在/已处理）'), { code: 'NOT_CONFIRMABLE' });

    let result;
    if (order.kind === 'credits') {
      // ref_id 是 UUID 列 → 传订单主键；幂等键仍用对外订单号。
      const balance = await topupCredits(client, {
        userId: order.user_id, amount: order.payload.credits, refId: order.id,
      });
      result = { kind: 'credits', credits: order.payload.credits, balance };
    } else if (order.kind === 'vip') {
      // 续期叠加：未过期则从当前到期日起加，否则从现在起加。
      const cur = await client.query(
        `SELECT expires_at FROM user_entitlements
         WHERE user_id=$1 AND entitlement_key='vip' AND enabled=TRUE
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [order.user_id]
      );
      const base = cur.rows[0]?.expires_at ? new Date(cur.rows[0].expires_at) : new Date();
      const expiresAt = new Date(base.getTime() + order.payload.days * 86400000);
      await grantVip({
        userId: order.user_id, expiresAt, grantedBy: adminId,
        reason: `payment:${order.order_no}`, client,
      });
      result = { kind: 'vip', expiresAt, days: order.payload.days };
    } else {
      throw Object.assign(new Error(`未知商品类型 ${order.kind}`), { code: 'UNKNOWN_KIND' });
    }

    await client.query('COMMIT');
    trackEvent({ userId: order.user_id, event: 'payment_paid', props: { orderNo: order.order_no, sku: order.sku_code, amountCents: order.amount_cents, channel: order.channel } });
    return { order, result };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
};

// ---------- 管理端：待确认列表 / 全量列表 ----------
export const listOrders = async ({ status, limit = 50 }) => {
  const where = status ? `WHERE o.status = $1` : '';
  const params = status ? [status, limit] : [limit];
  const { rows } = await pool.query(
    `SELECT o.order_no, o.sku_code, o.title, o.kind, o.amount_cents, o.channel, o.status,
            o.provider_ref, o.paid_at, o.created_at, u.email AS user_email
     FROM payment_orders o JOIN users u ON u.id = o.user_id
     ${where} ORDER BY o.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
};

// ---------- 对账汇总：按日 × 渠道 × SKU ----------
export const reconcileSummary = async ({ days = 30 }) => {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') AS day, channel, sku_code,
            count(*) AS orders, SUM(amount_cents) AS amount_cents
     FROM payment_orders
     WHERE status='paid' AND paid_at >= NOW() - ($1 || ' days')::interval
     GROUP BY 1,2,3 ORDER BY 1 DESC, amount_cents DESC`,
    [String(days)]
  );
  const { rows: totals } = await pool.query(
    `SELECT count(*) AS orders, COALESCE(SUM(amount_cents),0) AS amount_cents,
            count(*) FILTER (WHERE kind='vip') AS vip_orders,
            count(*) FILTER (WHERE kind='credits') AS credits_orders
     FROM payment_orders WHERE status='paid' AND paid_at >= NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return { byDay: rows, totals: totals[0] };
};

// 支付订单路由：用户下单/查单/取消 + 管理员确认/对账。
import { Router } from 'express';
import { requireUser, requireAdmin, adminLimiter, wrap } from '../auth/middleware.js';
import { PolicyError } from '../model-gateway/policy.js';
import {
  createOrder, getUserOrders, getOrderByNo, cancelOrder, confirmOrder, listOrders, reconcileSummary, listChannels,
} from '../payments/index.js';
import { SKUS } from '../payments/skus.js';
import { getBalance } from '../credits.js';

const errStatus = (e) => (['UNKNOWN_SKU', 'UNKNOWN_CHANNEL', 'NOT_CANCELLABLE', 'NOT_CONFIRMABLE', 'CHANNEL_NOT_CONFIGURED'].includes(e?.code) ? 422 : 502);
const sendErr = (res, e) => {
  if (e instanceof PolicyError || e?.code) {
    if (errStatus(e) >= 500) console.error('[payments] server error:', e);
    return res.status(errStatus(e)).json({ error: e.message, code: e.code });
  }
  throw e;
};

// ---------- 用户端 ----------
export const paymentsRouter = Router();
paymentsRouter.use(wrap(requireUser));

paymentsRouter.get('/skus', (req, res) => {
  res.json({
    skus: Object.entries(SKUS).map(([code, s]) => ({ code, ...s })),
    channels: listChannels().filter((c) => c.key === 'manual'),
  });
});

paymentsRouter.post(
  '/orders',
  wrap(async (req, res) => {
    try {
      const { skuCode, channel = 'manual' } = req.body || {};
      const { order, pay } = await createOrder({ userId: req.user.user_id, skuCode, channel });
      res.status(201).json({ order: { orderNo: order.order_no, title: order.title, kind: order.kind, amountCents: order.amount_cents, status: order.status, createdAt: order.created_at }, pay });
    } catch (e) { sendErr(res, e); }
  })
);

paymentsRouter.get(
  '/orders',
  wrap(async (req, res) => {
    const rows = await getUserOrders({ userId: req.user.user_id });
    res.json({ orders: rows.map((o) => ({ ...o, amount: (o.amount_cents / 100).toFixed(2) })) });
  })
);

paymentsRouter.get(
  '/orders/:orderNo',
  wrap(async (req, res) => {
    const order = await getOrderByNo(req.params.orderNo);
    if (!order || order.user_id !== req.user.user_id) return res.status(404).json({ error: '订单不存在' });
    res.json({ order: { orderNo: order.order_no, status: order.status, kind: order.kind, amountCents: order.amount_cents, title: order.title } });
  })
);

paymentsRouter.post(
  '/orders/:orderNo/cancel',
  wrap(async (req, res) => {
    try {
      await cancelOrder({ userId: req.user.user_id, orderNo: req.params.orderNo });
      res.json({ ok: true });
    } catch (e) { sendErr(res, e); }
  })
);

// ---------- 管理端（/api/admin/payments/*）----------
export const adminPaymentsRouter = Router();
adminPaymentsRouter.use(wrap(requireUser), wrap(requireAdmin), adminLimiter);

adminPaymentsRouter.get(
  '/orders',
  wrap(async (req, res) => {
    const status = ['pending', 'paid', 'cancelled', 'expired', 'refunded'].includes(req.query.status) ? req.query.status : undefined;
    res.json({ orders: await listOrders({ status, limit: 100 }) });
  })
);

adminPaymentsRouter.post(
  '/orders/:orderNo/confirm',
  wrap(async (req, res) => {
    try {
      const { order, result } = await confirmOrder({
        orderNo: req.params.orderNo, adminId: req.user.user_id, providerRef: req.body?.providerRef || null,
      });
      res.json({ ok: true, orderNo: order.order_no, result, userBalance: await getBalance(order.user_id) });
    } catch (e) { sendErr(res, e); }
  })
);

adminPaymentsRouter.get(
  '/reconcile',
  wrap(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.json(await reconcileSummary({ days }));
  })
);

// 支付客户端：SKU/下单/查单/取消 + 管理端确认与对账。
import { apiFetch } from './storageService';

export interface SkuDTO { code: string; kind: 'credits' | 'vip'; title: string; amountCents: number; currency: string; payload: { credits?: number; days?: number }; }
export interface OrderDTO {
  orderNo: string; skuCode: string; title: string; kind: string; amountCents: number;
  currency: string; channel: string; status: string; providerRef?: string | null;
  paidAt?: string | null; createdAt: string; user_email?: string;
}
export interface CreateOrderResult { order: OrderDTO; pay: { mode: string; instructions: string }; }

export const listSkus = async (): Promise<{ skus: SkuDTO[]; channels: { key: string; label: string }[] }> =>
  apiFetch('/payments/skus');

export const createOrder = async (skuCode: string, channel = 'manual'): Promise<CreateOrderResult> =>
  apiFetch('/payments/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skuCode, channel }),
  });

export const myOrders = async (): Promise<{ orders: OrderDTO[] }> => apiFetch('/payments/orders');

export const cancelOrder = async (orderNo: string): Promise<{ ok: boolean }> =>
  apiFetch(`/payments/orders/${orderNo}/cancel`, { method: 'POST' });

export const adminListOrders = async (status?: string): Promise<{ orders: OrderDTO[] }> =>
  apiFetch(`/admin/payments/orders${status ? `?status=${status}` : ''}`);

export const adminConfirm = async (orderNo: string, providerRef?: string): Promise<{ ok: boolean; result: any; userBalance?: number }> =>
  apiFetch(`/admin/payments/orders/${orderNo}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerRef }),
  });

export const adminReconcile = async (days = 30): Promise<{
  byDay: { day: string; channel: string; sku_code: string; orders: string; amount_cents: string }[];
  totals: { orders: string; amount_cents: string; vip_orders: string; credits_orders: string };
}> => apiFetch(`/admin/payments/reconcile?days=${days}`);

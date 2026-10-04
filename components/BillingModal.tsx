// 充值/购买弹窗：SKU 列表 → 下单（manual 人工转账）→ 转账说明 + 我的订单。
import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Clock, CheckCircle2, XCircle, Wallet } from 'lucide-react';
import { listSkus, createOrder, myOrders, cancelOrder } from '../services/paymentsClient';
import type { SkuDTO, OrderDTO } from '../services/paymentsClient';

const yuan = (cents: number) => (cents / 100).toFixed(2);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { icon: React.ReactNode; cls: string; text: string }> = {
    pending: { icon: <Clock size={11} />, cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10', text: '待支付' },
    paid: { icon: <CheckCircle2 size={11} />, cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10', text: '已到账' },
    cancelled: { icon: <XCircle size={11} />, cls: 'text-slate-400 border-white/10 bg-white/5', text: '已取消' },
  };
  const s = map[status] || map.cancelled;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${s.cls}`}>
      {s.icon}{s.text}
    </span>
  );
};

interface Props { open: boolean; onClose: () => void; onPaid?: () => void; }

export default function BillingModal({ open, onClose, onPaid }: Props) {
  const [skus, setSkus] = useState<SkuDTO[]>([]);
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [payInfo, setPayInfo] = useState<{ instructions: string; orderNo: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const reloadOrders = async () => {
    try { setOrders((await myOrders()).orders); } catch { /* 忽略 */ }
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    setPayInfo(null);
    listSkus().then((d) => setSkus(d.skus)).catch(() => setError('商品加载失败'));
    reloadOrders();
  }, [open]);

  if (!open) return null;

  const buy = async (sku: SkuDTO) => {
    setBusy(sku.code); setError(''); setPayInfo(null);
    try {
      const { order, pay } = await createOrder(sku.code);
      setPayInfo({ instructions: pay.instructions, orderNo: order.orderNo });
      await reloadOrders();
    } catch (e: any) {
      setError(e?.message || '下单失败');
    } finally { setBusy(''); }
  };

  const cancel = async (orderNo: string) => {
    setBusy(orderNo);
    try { await cancelOrder(orderNo); await reloadOrders(); }
    catch (e: any) { setError(e?.message || '取消失败'); }
    finally { setBusy(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <Wallet size={16} className="text-cyan-300" /> 充值与会员
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="grid grid-cols-2 gap-2">
          {skus.map((s) => (
            <button
              key={s.code}
              disabled={busy === s.code}
              onClick={() => buy(s)}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/5 disabled:opacity-50"
            >
              <div className="text-xs text-slate-300">{s.title}</div>
              <div className="mt-1 text-lg font-bold text-white">¥{yuan(s.amountCents)}</div>
              <div className="text-[10px] text-slate-500">
                {s.kind === 'credits' ? `+${s.payload.credits} 积分` : `会员 ${s.payload.days} 天`}
              </div>
            </button>
          ))}
        </div>

        {payInfo && (
          <div className="mt-4 rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3">
            <div className="text-xs font-medium text-cyan-200">订单已创建：{payInfo.orderNo}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{payInfo.instructions}</p>
            <button
              onClick={() => { navigator.clipboard?.writeText(payInfo.orderNo).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/5"
            >
              {copied ? <Check size={11} className="text-emerald-300" /> : <Copy size={11} />}
              {copied ? '已复制' : '复制订单号'}
            </button>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-medium text-slate-400">我的订单</div>
          {orders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-slate-500">暂无订单</div>
          ) : (
            <div className="space-y-1.5">
              {orders.map((o) => (
                <div key={o.orderNo} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-slate-200">{o.title} · ¥{yuan(o.amountCents)}</div>
                    <div className="text-[10px] text-slate-500">{o.orderNo}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={o.status} />
                    {o.status === 'pending' && (
                      <button
                        disabled={busy === o.orderNo}
                        onClick={() => cancel(o.orderNo)}
                        className="text-[10px] text-slate-500 hover:text-red-300 disabled:opacity-50"
                      >取消</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
          支付方式：人工转账（管理员核对到账后自动入账）。接入支付宝/微信后此处将直接展示扫码支付。
        </p>
      </div>
    </div>
  );
}

// SKU 目录（MVP：配置即目录；后续可挪库并加管理端 CRUD）。
// amount_cents 单位为分。payload 携带入账参数快照，确认入账时不重新读价目。
export const SKUS = {
  credits_small: { kind: 'credits', title: '积分包 · 1000', amountCents: 990, payload: { credits: 1000 } },
  credits_large: { kind: 'credits', title: '积分包 · 6000（加量）', amountCents: 4900, payload: { credits: 6000 } },
  vip_month:     { kind: 'vip',     title: 'VIP 会员 · 月度', amountCents: 2900, payload: { days: 30 } },
  vip_year:      { kind: 'vip',     title: 'VIP 会员 · 年度（推荐）', amountCents: 19900, payload: { days: 365 } },
};

export const resolveSku = (code) => SKUS[code] || null;

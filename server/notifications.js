// 站内通知：写入 helper、VIP 到期扫描（定时器复用 outbox/backup 的模式）。
// job 终态通知在 model-gateway/gateway.js 的 pollJob 事务内直接写入。
import { pool } from './db.js';

// 幂等：同一用户同一 kind 在去重窗口内只保留一条未读通知。
export const createNotification = async (
  client,
  { userId, kind, payload = {} },
  { dedupeHours = 72 } = {}
) => {
  await client.query(
    `INSERT INTO notifications (id, user_id, kind, payload)
     SELECT gen_random_uuid(), $1::uuid, $2::varchar, $3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE user_id = $1::uuid AND kind = $2::varchar
         AND read_at IS NULL
         AND created_at > NOW() - ($4 || ' hours')::interval
     )`,
    [userId, kind, JSON.stringify(payload), String(dedupeHours)]
  );
};

// VIP 到期前 3 天提醒：定时扫描，去重窗口防止重复打扰。
export const notifyVipExpiring = async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ue.user_id, ue.expires_at
     FROM user_entitlements ue
     JOIN users u ON u.id = ue.user_id
     WHERE ue.entitlement_key = 'vip' AND ue.enabled = TRUE
       AND ue.expires_at IS NOT NULL
       and ue.expires_at > NOW()
       AND ue.expires_at < NOW() + interval '3 days'
       AND u.status = 'active'`
  );
  let count = 0;
  for (const row of rows) {
    await createNotification(
      pool,
      { userId: row.user_id, kind: 'vip_expiring', payload: { expiresAt: row.expires_at } },
      { dedupeHours: 72 }
    );
    count += 1;
  }
  return count;
};

export const startNotificationScheduler = () => {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => {
    notifyVipExpiring().catch((e) => console.error('[notifications] vip scan failed:', e.message));
  };
  const t = setTimeout(run, 60 * 1000);
  if (t.unref) t.unref();
  const i = setInterval(run, 6 * 60 * 60 * 1000);
  if (i.unref) i.unref();
};

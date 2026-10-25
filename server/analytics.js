// 极简埋点：生命周期事件（注册/建项目/兑换等）写入 analytics_events。
// 约束：
// - fail-open——埋点失败只打日志，绝不阻塞主流程；
// - 事件名白名单格式（小写字母/数字/下划线/点，防注入与脏数据）；
// - 经营漏斗（funnelStats）以核心表为准，本表仅作补充信号。
import { pool } from './db.js';

const EVENT_RE = /^[a-z0-9_.]{1,64}$/;

export const trackEvent = async ({ userId = null, event, props = {} }) => {
  if (typeof event !== 'string' || !EVENT_RE.test(event)) return;
  try {
    await pool.query(
      `INSERT INTO analytics_events (user_id, event, props) VALUES ($1, $2, $3::jsonb)`,
      [userId, event, JSON.stringify(props && typeof props === 'object' ? props : {})]
    );
  } catch (err) {
    console.warn('[analytics] track failed:', err.message);
  }
};

// 经营漏斗：注册 → 验证 → 建项目 → 首次生成成功 → 成为 VIP。
// 每一级都是「去重用户数」，来自核心表（不是事件表），避免 best-effort 埋点丢数据导致漏斗失真。
export const funnelStats = async () => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS registered,
      (SELECT COUNT(*)::int FROM users WHERE status = 'active' AND email_verified_at IS NOT NULL) AS verified,
      (SELECT COUNT(DISTINCT user_id)::int FROM projects) AS project_created,
      (SELECT COUNT(DISTINCT user_id)::int FROM model_invocations WHERE status = 'succeeded') AS first_generation,
      (SELECT COUNT(DISTINCT user_id)::int FROM user_entitlements WHERE entitlement_key = 'vip' AND enabled) AS became_vip
  `);
  return rows[0];
};

// 最近 N 天事件量（管理端补充视图用）
export const eventCounts = async ({ days = 7 } = {}) => {
  const { rows } = await pool.query(
    `SELECT event, COUNT(*)::int AS count
       FROM analytics_events
      WHERE created_at > NOW() - ($1 || ' days')::interval
      GROUP BY event ORDER BY count DESC LIMIT 20`,
    [String(Math.max(1, Math.min(90, days)))]
  );
  return rows;
};

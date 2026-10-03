// 埋点 analytics_events + 经营漏斗。
// 事件写入永不阻塞主流程（fail-open），漏斗以核心表为准（events 仅作补充信号）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, pool } from './helpers.js';
import { withUserContext } from '../db.js';
import { grantVip } from '../auth/entitlements.js';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
});

test.after(async () => {
  await pool.end();
});

test('trackEvent 写入事件与 props', async () => {
  const { trackEvent } = await import('../analytics.js');
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status)
     VALUES ($1, 'a@t.local', 'a@t.local', 'x', 'user', 'active') RETURNING id`,
    [crypto.randomUUID()]
  );
  const userId = rows[0].id;
  await trackEvent({ userId, event: 'project_created', props: { projectId: 'p1' } });
  const ev = await pool.query(`SELECT * FROM analytics_events WHERE user_id = $1`, [userId]);
  assert.equal(ev.rows.length, 1);
  assert.equal(ev.rows[0].event, 'project_created');
  assert.equal(ev.rows[0].props.projectId, 'p1');
});

test('trackEvent 对非法事件名静默拒绝（埋点不炸主流程）', async () => {
  const { trackEvent } = await import('../analytics.js');
  await assert.doesNotReject(() => trackEvent({ event: 'BAD EVENT; DROP TABLE users' }));
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM analytics_events WHERE event = $1`, [
    'BAD EVENT; DROP TABLE users',
  ]);
  assert.equal(rows[0].c, 0);
});

test('funnelStats 给出注册→验证→建项目→首次生成→成为VIP 五级漏斗', async () => {
  const { funnelStats } = await import('../analytics.js');
  // 种一个走到「建项目 + VIP」的用户和一个只注册的用户
  const u = await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES ($1, 'b@t.local', 'b@t.local', 'x', 'user', 'active', NOW()) RETURNING id`,
    [crypto.randomUUID()]
  );
  const userId = u.rows[0].id;
  await withUserContext({ userId, isAdmin: true }, async (client) => {
    await client.query(`INSERT INTO projects (id, data, user_id, last_modified) VALUES ('proj-f1', '{}', $1, 1)`, [
      userId,
    ]);
  });
  await grantVip({ userId, reason: 'test' });

  const funnel = await funnelStats();
  assert.ok(funnel.registered >= 2);
  assert.ok(funnel.verified >= 1);
  assert.ok(funnel.project_created >= 1);
  assert.equal(funnel.first_generation >= 0, true);
  assert.ok(funnel.became_vip >= 1);
});

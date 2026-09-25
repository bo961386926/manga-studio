// Auth routes: register, verify-email, login, logout, password reset, me, csrf.
// Design source: user-identity-access-design.md §6–§7. Anonymous mutations are
// protected globally by anonymousMutationGuard (Origin/Fetch Metadata).
import { Router } from 'express';
import { withTransaction, pool } from '../db.js';
import { ensureCreditAccount } from '../credits.js';
import {
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
} from './password.js';
import { hashToken, randomToken, consumeToken, invalidateTokens } from './tokens.js';
import {
  createSession,
  revokeSession,
  revokeAllSessions,
  rotateCsrf,
  cookieOptions,
  SESSION_COOKIE,
} from './session.js';
import { queueEmail } from './outbox.js';
import {
  requireUser,
  csrfProtection,
  loginLimiter,
  loginEmailLimiter,
  registerLimiter,
  resetLimiter,
  changePasswordLimiter,
  hashIp,
  wrap,
} from './middleware.js';
import { isRegistrationOpen } from './entitlements.js';
import { recordAudit } from './audit.js';

export const authRouter = Router();

const GENERIC_AUTH_FAILURE = { error: 'invalid credentials' };
const TOKEN_TTL = { verify_email: 24 * 60 * 60 * 1000, reset_password: 30 * 60 * 1000 };

// Dummy Argon2 hash so unknown-email logins cost the same as real ones.
let dummyHashPromise;
const getDummyHash = () => {
  dummyHashPromise ??= hashPassword('dummy-password-1234567890');
  return dummyHashPromise;
};

const makeToken = async (client, { userId, purpose, ttlMs }) => {
  const token = randomToken(32);
  const { rows } = await client.query(
    `INSERT INTO user_action_tokens (id, user_id, purpose, token_hash, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, NOW() + ($4 || ' milliseconds')::interval)
     RETURNING id`,
    [userId, purpose, hashToken(token), ttlMs]
  );
  return { id: rows[0].id, token };
};

// ---------- register ----------

authRouter.post(
  '/register',
  registerLimiter,
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!(await isRegistrationOpen())) {
      return res.status(403).json({ error: 'registration closed' });
    }
    const normalized = normalizeEmail(email);
    if (!normalized || !validatePassword(password)) {
      return res.status(422).json({ error: 'invalid email or password' });
    }
    const passwordHash = await hashPassword(password);
    let createdUserId = null;
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (id, email, email_normalized, password_hash, role, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 'user', 'pending_verification')
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [normalized, normalized, passwordHash]
      );
      if (rows.length === 0) return; // already registered; never leak account existence
      createdUserId = rows[0].id;
      // 注册赠送积分（幂等，懒创建兜底由 credits 模块负责）
      await ensureCreditAccount(client, createdUserId);
      const { id: actionTokenId, token: actionToken } = await makeToken(client, {
        userId: createdUserId,
        purpose: 'verify_email',
        ttlMs: TOKEN_TTL.verify_email,
      });
      await queueEmail(client, {
        userId: createdUserId,
        purpose: 'verify_email',
        actionTokenId,
        kind: 'verify_email',
        recipientEmail: normalized,
        actionToken,
      });
    });
    if (createdUserId) {
      await recordAudit({
        actorUserId: null,
        targetUserId: createdUserId,
        eventType: 'auth.register',
        result: 'success',
        requestId: req.id,
        ipHash: hashIp(req.ip),
        metadata: { action: 'register' },
      });
    }
    return res.status(202).json({ success: true });
  })
);

// ---------- verify email (token arrives via URL fragment; POST here) ----------

authRouter.post(
  '/verify-email',
  wrap(async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(422).json({ error: 'token required' });
    let userId = null;
    const ok = await withTransaction(async (client) => {
      const consumed = await consumeToken(client, hashToken(token), 'verify_email');
      if (!consumed) return false;
      userId = consumed.user_id;
      await client.query(
        `UPDATE users SET email_verified_at = NOW(), status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [consumed.user_id]
      );
      return true;
    });
    await recordAudit({
      actorUserId: userId,
      targetUserId: userId,
      eventType: 'auth.verify_email',
      result: ok ? 'success' : 'failure',
      requestId: req.id,
      ipHash: hashIp(req.ip),
      metadata: { action: 'verify_email' },
    });
    if (!ok) return res.status(400).json({ error: 'invalid or expired token' });
    return res.json({ success: true });
  })
);

// ---------- login ----------

authRouter.post(
  '/login',
  loginLimiter,
  loginEmailLimiter,
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const normalized = normalizeEmail(email);
    const dummyHash = await getDummyHash();
    if (!normalized || typeof password !== 'string') {
      await verifyPassword(dummyHash, password || '');
      return res.status(401).json(GENERIC_AUTH_FAILURE);
    }
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, status FROM users WHERE email_normalized = $1',
      [normalized]
    );
    const user = rows[0];
    const hash = user?.password_hash || dummyHash;
    const passwordOk = await verifyPassword(hash, password);
    if (!user || !passwordOk || user.status !== 'active') {
      await recordAudit({
        eventType: 'auth.login',
        result: 'failure',
        requestId: req.id,
        ipHash: hashIp(req.ip),
        metadata: { action: 'login' },
      });
      return res.status(401).json(GENERIC_AUTH_FAILURE);
    }
    const ipHash = hashIp(req.ip);
    const userAgentSummary = String(req.headers['user-agent'] || '').slice(0, 255);
    const { token, csrf, expiresAt, sessionId } = await withTransaction(async (client) => {
      const created = await createSession(client, { userId: user.id, ipHash, userAgentSummary });
      await client.query(
        `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [user.id]
      );
      return created;
    });
    await recordAudit({
      actorUserId: user.id,
      targetUserId: user.id,
      eventType: 'auth.login',
      result: 'success',
      requestId: req.id,
      ipHash,
      metadata: { action: 'login' },
    });
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
    return res.json({ user: { id: user.id, email: user.email }, csrfToken: csrf, sessionId });
  })
);

// ---------- logout ----------

authRouter.post(
  '/logout',
  wrap(requireUser),
  wrap(csrfProtection),
  wrap(async (req, res) => {
    await withTransaction(async (client) => {
      await revokeSession(client, req.user.session_id);
    });
    await recordAudit({
      actorUserId: req.user.user_id,
      targetUserId: req.user.user_id,
      eventType: 'auth.logout',
      result: 'success',
      requestId: req.id,
      ipHash: hashIp(req.ip),
      metadata: { action: 'logout' },
    });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    return res.json({ success: true });
  })
);

// ---------- authenticated password change ----------

authRouter.post(
  '/change-password',
  changePasswordLimiter,
  wrap(requireUser),
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !validatePassword(newPassword)) {
      return res.status(422).json({ error: 'invalid password' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      req.user.user_id,
    ]);
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
      await recordAudit({
        actorUserId: req.user.user_id,
        targetUserId: req.user.user_id,
        eventType: 'auth.change_password',
        result: 'failure',
        requestId: req.id,
        ipHash: hashIp(req.ip),
        metadata: { action: 'change_password' },
      });
      return res.status(400).json({ error: 'current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);
    const ipHash = hashIp(req.ip);
    const userAgentSummary = String(req.headers['user-agent'] || '').slice(0, 255);
    const replacement = await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $2, session_version = session_version + 1, updated_at = NOW()
         WHERE id = $1`,
        [req.user.user_id, passwordHash]
      );
      await revokeAllSessions(client, req.user.user_id);
      return createSession(client, { userId: req.user.user_id, ipHash, userAgentSummary });
    });

    await recordAudit({
      actorUserId: req.user.user_id,
      targetUserId: req.user.user_id,
      eventType: 'auth.change_password',
      result: 'success',
      requestId: req.id,
      ipHash,
      metadata: { action: 'change_password' },
    });
    res.cookie(SESSION_COOKIE, replacement.token, {
      ...cookieOptions(),
      expires: replacement.expiresAt,
    });
    return res.json({ success: true, csrfToken: replacement.csrf });
  })
);

// ---------- password reset ----------

authRouter.post(
  '/request-password-reset',
  resetLimiter,
  wrap(async (req, res) => {
    const normalized = normalizeEmail(req.body?.email);
    // Always return the same success response; do not reveal account existence.
    if (normalized) {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          'SELECT id FROM users WHERE email_normalized = $1 AND status = \'active\'',
          [normalized]
        );
        const user = rows[0];
        if (!user) return;
        await invalidateTokens(client, user.id, 'reset_password');
        const { id: actionTokenId, token: actionToken } = await makeToken(client, {
          userId: user.id,
          purpose: 'reset_password',
          ttlMs: TOKEN_TTL.reset_password,
        });
        await queueEmail(client, {
          userId: user.id,
          purpose: 'reset_password',
          actionTokenId,
          kind: 'reset_password',
          recipientEmail: normalized,
          actionToken,
        });
      });
    }
    return res.status(202).json({ success: true });
  })
);

authRouter.post(
  '/reset-password',
  wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !validatePassword(password)) {
      return res.status(422).json({ error: 'invalid token or password' });
    }
    const passwordHash = await hashPassword(password);
    const ok = await withTransaction(async (client) => {
      const consumed = await consumeToken(client, hashToken(token), 'reset_password');
      if (!consumed) return false;
      await client.query(
        `UPDATE users
         SET password_hash = $2, session_version = session_version + 1, updated_at = NOW()
         WHERE id = $1`,
        [consumed.user_id, passwordHash]
      );
      await revokeAllSessions(client, consumed.user_id);
      return true;
    });
    if (!ok) return res.status(400).json({ error: 'invalid or expired token' });
    return res.json({ success: true });
  })
);

// ---------- me / csrf ----------

authRouter.get('/me', wrap(requireUser), (req, res) => {
  res.json({
    id: req.user.user_id,
    email: req.user.email,
    role: req.user.role,
    status: req.user.status,
  });
});

authRouter.get(
  '/csrf',
  wrap(requireUser),
  wrap(async (req, res) => {
    const csrfToken = await withTransaction(async (client) => rotateCsrf(client, req.user.session_id));
    res.json({ csrfToken });
  })
);

// ---------- bootstrap admin completion (set password + verify + activate) ----------

authRouter.post(
  '/bootstrap-complete',
  wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !validatePassword(password)) {
      return res.status(422).json({ error: 'invalid token or password' });
    }
    const passwordHash = await hashPassword(password);
    const ok = await withTransaction(async (client) => {
      const consumed = await consumeToken(client, hashToken(token), 'bootstrap_admin');
      if (!consumed) return false;
      const { rows } = await client.query('SELECT status FROM users WHERE id = $1', [
        consumed.user_id,
      ]);
      if (!rows[0] || rows[0].status !== 'pending_verification') return false;
      await client.query(
        `UPDATE users SET password_hash = $2, email_verified_at = NOW(),
                status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [consumed.user_id, passwordHash]
      );
      return true;
    });
    await recordAudit({
      eventType: 'auth.bootstrap_complete',
      result: ok ? 'success' : 'failure',
      requestId: req.id,
      ipHash: hashIp(req.ip),
      metadata: { action: 'bootstrap_complete' },
    });
    if (!ok) return res.status(400).json({ error: 'invalid or expired token' });
    return res.json({ success: true });
  })
);

// ---------- reauthenticate (15-minute window for high-risk admin actions) ----------

authRouter.post(
  '/reauthenticate',
  wrap(requireUser),
  wrap(csrfProtection),
  wrap(async (req, res) => {
    const { password } = req.body || {};
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      req.user.user_id,
    ]);
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, password || ''))) {
      return res.status(401).json({ error: 'invalid password' });
    }
    await pool.query('UPDATE sessions SET reauthenticated_at = NOW() WHERE id = $1', [
      req.user.session_id,
    ]);
    await recordAudit({
      actorUserId: req.user.user_id,
      targetUserId: req.user.user_id,
      eventType: 'auth.reauthenticate',
      result: 'success',
      requestId: req.id,
      ipHash: hashIp(req.ip),
      metadata: { action: 'reauthenticate' },
    });
    return res.json({ success: true });
  })
);

// Email outbox: transactional queueing, encrypted action tokens, and a
// SKIP LOCKED worker with bounded retries. SMTP via nodemailer; development
// falls back to console output.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import { randomToken } from './tokens.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60 * 1000;

// ---------- delivery-key AEAD for action tokens ----------

const DELIVERY_KEY_ID = process.env.EMAIL_DELIVERY_KEY_ID || 'v1';
// Production must set EMAIL_DELIVERY_KEY (32-byte hex). Development uses a
// fixed derivation so pending rows survive restarts; never use it in prod.
const deliveryKey = () =>
  crypto
    .createHash('sha256')
    .update(process.env.EMAIL_DELIVERY_KEY || 'dev-only-delivery-key-do-not-use-in-prod')
    .digest();

export const sealActionToken = ({ outboxId, userId, purpose, actionTokenId, token }) => {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`outbox:${outboxId}|user:${userId}|purpose:${purpose}|token:${actionTokenId}|key:${DELIVERY_KEY_ID}`);
  const cipher = crypto.createCipheriv('aes-256-gcm', deliveryKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag, keyId: DELIVERY_KEY_ID };
};

export const openActionToken = ({ outboxId, userId, purpose, actionTokenId, keyId, ciphertext, iv, tag }) => {
  if (keyId !== DELIVERY_KEY_ID) throw new Error('unknown delivery key id');
  const aad = Buffer.from(`outbox:${outboxId}|user:${userId}|purpose:${purpose}|token:${actionTokenId}|key:${keyId}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deliveryKey(), iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

// ---------- queueing (inside the caller's transaction) ----------

export const queueEmail = async (
  client,
  { userId, purpose, actionTokenId, kind, recipientEmail, actionToken }
) => {
  const { rows: [row] } = await client.query(
    `INSERT INTO email_outbox
       (id, user_id, purpose, action_token_id, kind, recipient_email, template_data, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, 'pending')
     RETURNING id`,
    [userId, purpose, actionTokenId, kind, recipientEmail, JSON.stringify({})]
  );
  const sealed = sealActionToken({
    outboxId: row.id,
    userId,
    purpose,
    actionTokenId,
    token: actionToken,
  });
  await client.query(
    `UPDATE email_outbox
     SET action_token_ciphertext = $2, action_token_iv = $3, action_token_tag = $4, action_token_key_id = $5
     WHERE id = $1`,
    [row.id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId]
  );
  return row.id;
};

// ---------- templates ----------

const actionUrl = (path, token) => {
  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
  // Token travels in the URL fragment so it never reaches the server via logs.
  return `${base}/#${path}?token=${encodeURIComponent(token)}`;
};

export const renderEmail = (purpose, { recipientEmail, token }) => {
  if (purpose === 'verify_email') {
    return {
      subject: '验证你的漫剧工场账号',
      text: `点击以下链接验证邮箱（24 小时内有效）：\n${actionUrl('/verify-email', token)}`,
    };
  }
  if (purpose === 'reset_password') {
    return {
      subject: '重置你的漫剧工场密码',
      text: `点击以下链接重置密码（30 分钟内有效）：\n${actionUrl('/reset-password', token)}`,
    };
  }
  if (purpose === 'bootstrap_admin') {
    return {
      subject: '漫剧工场管理员设置',
      text: `点击以下链接完成管理员设置（一次性）：\n${actionUrl('/bootstrap', token)}`,
    };
  }
  throw new Error(`unknown email purpose: ${purpose}`);
};

// ---------- sending ----------

let transporter = null;
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
        : undefined,
    });
  }
  return transporter;
};

const sendMail = async (mail) => {
  const t = getTransporter();
  if (!t) {
    // Development fallback: print the full message so local signup/reset
    // flows can be completed (spec §8 allows console output in dev).
    // Production never reaches this branch without SMTP configured.
    console.log(`[mail:dev] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  await t.sendMail(mail);
};

// ---------- worker ----------

export const claimPendingEmails = async ({ limit = 10, leaseMs = 60 * 1000 } = {}) => {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + leaseMs);
  const { rows } = await pool.query(
    `UPDATE email_outbox
     SET status = 'sending', lease_owner = $1, lease_expires_at = $2,
         attempt_count = attempt_count + 1
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, purpose, action_token_id, kind, recipient_email,
               action_token_ciphertext, action_token_iv, action_token_tag,
               action_token_key_id, attempt_count`,
    [process.pid, leaseUntil, limit]
  );
  return rows;
};

export const processOne = async (row) => {
  const token = openActionToken({
    outboxId: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    actionTokenId: row.action_token_id,
    keyId: row.action_token_key_id,
    ciphertext: row.action_token_ciphertext,
    iv: row.action_token_iv,
    tag: row.action_token_tag,
  });
  const mail = renderEmail(row.purpose, { recipientEmail: row.recipient_email, token });
  await sendMail({
    from: process.env.SMTP_FROM || 'no-reply@example.com',
    to: row.recipient_email,
    subject: mail.subject,
    text: mail.text,
  });
};

export const processOutbox = async ({ limit = 10 } = {}) => {
  const rows = await claimPendingEmails({ limit });
  let sent = 0;
  for (const row of rows) {
    try {
      await processOne(row);
      await pool.query(
        `UPDATE email_outbox SET status = 'sent', sent_at = NOW(),
                action_token_ciphertext = NULL, action_token_iv = NULL,
                action_token_tag = NULL, action_token_key_id = NULL
         WHERE id = $1`,
        [row.id]
      );
      sent += 1;
    } catch (err) {
      const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (row.attempt_count - 1), 24 * 60 * 60 * 1000);
      const next = new Date(Date.now() + backoff);
      if (row.attempt_count >= MAX_ATTEMPTS) {
        await pool.query(
          `UPDATE email_outbox SET status = 'dead', last_error_code = $2, next_attempt_at = $3 WHERE id = $1`,
          [row.id, String(err.code || err.message).slice(0, 63), next]
        );
      } else {
        await pool.query(
          `UPDATE email_outbox SET status = 'pending', last_error_code = $2, next_attempt_at = $3 WHERE id = $1`,
          [row.id, String(err.code || err.message).slice(0, 63), next]
        );
      }
    }
  }
  return { claimed: rows.length, sent };
};

// Poll worker used by the server (unref'd so it never blocks shutdown).
export const startOutboxWorker = ({ intervalMs = 5000, limit = 10 } = {}) => {
  const timer = setInterval(() => {
    processOutbox({ limit }).catch((err) => {
      console.error('[outbox] worker error:', err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
};

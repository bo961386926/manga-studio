// Express middleware: security headers, CORS allowlist, request id, rate
// limits, anonymous mutation origin guard, session auth, CSRF, and role gates.
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { readSession, SESSION_COOKIE } from './session.js';
import { hashToken } from './tokens.js';

// Wrap async middleware so rejected promises reach Express's error path.
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ---------- request id ----------

export const requestId = (req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// ---------- IP audit hashing (HMAC so values are not offline-enumerable) ----------

const isProd = () => process.env.NODE_ENV === 'production';

const ipHmacSalt = () => {
  const raw = process.env.IP_HMAC_SALT;
  // Fail closed: a public salt makes IP hashes offline-enumerable.
  if (!raw && isProd()) throw new Error('IP_HMAC_SALT is required in production');
  return raw || 'dev-ip-hmac-salt';
};

export const hashIp = (ip) =>
  crypto.createHmac('sha256', ipHmacSalt()).update(String(ip || '')).digest('hex');

// ---------- security headers ----------

export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};

// ---------- cookie parsing (no extra dependency) ----------

export const parseCookies = (req) => {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
};

// ---------- CORS allowlist ----------

export const getAllowedOrigins = () =>
  (process.env.CORS_ORIGINS || (
    process.env.NODE_ENV === 'production'
      ? ''
      : 'http://localhost:3000,http://localhost:5173'
  ))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const corsAllowlist = (req, res, next) => {
  const origin = req.get('origin');
  if (origin && getAllowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Idempotency-Key');
  }
  // Never emit a wildcard: non-allowlisted origins simply get no ACAO header.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};

// ---------- rate limiting (single-process store; shared store required for multi-instance) ----------

const buckets = new Map();
let limiterSeq = 0;

// Bound memory: adversarial clients can mint unlimited key values (per-IP,
// per-email), so sweep expired buckets once the map grows large.
const MAX_BUCKETS = 50000;
const sweepExpired = (now) => {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
};

// Default key is req.ip, which honours app.set('trust proxy', ...) so all
// clients behind the single nginx hop do not collapse into one bucket.
export const rateLimit = ({ windowMs, max, keyFn = (req) => req.ip }) => {
  // Each limiter instance needs its own bucket namespace, otherwise shared
  // IP keys let one limiter's counts overflow another's max.
  const id = ++limiterSeq;
  return (req, res, next) => {
    const key = `${id}:${keyFn(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    sweepExpired(now);
    if (bucket.count > max) {
      return res.status(429).json({ error: 'rate limited' });
    }
    next();
  };
};

export const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
export const loginEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFn: (req) => `login:${String(req.body?.email || '').toLowerCase().trim()}`,
});
export const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
export const emailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
export const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
export const changePasswordLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
export const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

// ---------- anonymous mutation origin guard ----------

const isUnsafe = (req) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

export const anonymousMutationGuard = (req, res, next) => {
  if (!isUnsafe(req)) return next();
  if (req.user) return next(); // session-authenticated mutations are CSRF-protected
  const origin = req.get('origin');
  const allowed = getAllowedOrigins();
  const originOk = Boolean(origin) && allowed.includes(origin);
  const secFetchSite = req.get('sec-fetch-site');
  const sameOrigin = !origin && secFetchSite === 'same-origin';
  const nonBrowser = !origin && !secFetchSite; // curl / non-browser clients
  if (!originOk && !sameOrigin && !nonBrowser) {
    return res.status(403).json({ error: 'origin not allowed' });
  }
  next();
};

// ---------- session auth ----------

export const requireUser = async (req, res, next) => {
  const cookies = parseCookies(req);
  const session = await readSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = session;
  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
};

// ---------- CSRF (session-authenticated mutations) ----------

export const csrfProtection = async (req, res, next) => {
  if (!isUnsafe(req)) return next();
  if (!req.user) return next(); // anonymous mutations covered by anonymousMutationGuard
  const provided = req.get('x-csrf-token');
  if (!provided) return res.status(403).json({ error: 'csrf token required' });
  const { rows } = await pool.query(
    'SELECT csrf_token_hash, csrf_expires_at FROM sessions WHERE id = $1',
    [req.user.session_id]
  );
  const row = rows[0];
  if (!row || !row.csrf_token_hash || !row.csrf_expires_at || row.csrf_expires_at < new Date()) {
    return res.status(403).json({ error: 'csrf token invalid' });
  }
  if (hashToken(provided) !== row.csrf_token_hash) {
    return res.status(403).json({ error: 'csrf token mismatch' });
  }
  next();
};

// ---------- recent reauthentication for high-risk admin actions ----------

export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export const requireRecentReauth = async (req, res, next) => {
  const { rows } = await pool.query(
    'SELECT reauthenticated_at FROM sessions WHERE id = $1',
    [req.user.session_id]
  );
  const at = rows[0]?.reauthenticated_at;
  if (!at || new Date(at).getTime() < Date.now() - REAUTH_WINDOW_MS) {
    return res.status(403).json({ error: 'reauthentication required' });
  }
  next();
};

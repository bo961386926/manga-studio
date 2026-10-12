// Self-hosted SVG captcha for login/register bot friction ("防君子" tier).
// Zero dependencies: hand-rolled distorted-glyph SVG + in-memory single-use
// store. CAPTCHA_ENABLED is read per-request (not at import) so tests and
// staged rollouts can toggle it via env; production .env sets it to 'true'.
import crypto from 'node:crypto';

const CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 排除 0O1lI 易混淆字符
const CODE_LENGTH = 4;
const TTL_MS = 10 * 60 * 1000; // 10 分钟有效
const MAX_STORE = 5000; // 防内存膨胀的懒清理阈值

const store = new Map(); // captchaId -> { answer, expiresAt }

export const captchaEnabled = () => process.env.CAPTCHA_ENABLED === 'true';

const prune = (now) => {
  if (store.size < MAX_STORE) return;
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 扭曲字符 SVG：随机旋转/字号/颜色 + 干扰线与噪点，防止最基础的 OCR。
const renderSvg = (code) => {
  const width = 132;
  const height = 44;
  const palette = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c'];
  const step = width / (CODE_LENGTH + 1);
  const glyphs = code
    .split('')
    .map((ch, i) => {
      const x = step * (i + 0.6) + randomBetween(-2, 2);
      const y = height / 2 + randomBetween(4, 8);
      const rotate = randomBetween(-24, 24).toFixed(1);
      const fontSize = randomBetween(24, 30).toFixed(0);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" fill="${pick(palette)}" text-anchor="middle">${ch}</text>`;
    })
    .join('');
  const lines = Array.from({ length: 3 }, () => {
    const y1 = randomBetween(4, height - 4);
    const y2 = randomBetween(4, height - 4);
    return `<path d="M0 ${y1.toFixed(1)} C ${width / 3} ${(y1 - 10).toFixed(1)}, ${(width * 2) / 3} ${(y2 + 10).toFixed(1)}, ${width} ${y2.toFixed(1)}" stroke="${pick(palette)}" stroke-opacity="0.35" stroke-width="1.4" fill="none"/>`;
  }).join('');
  const dots = Array.from({ length: 24 }, () => {
    const cx = randomBetween(0, width).toFixed(1);
    const cy = randomBetween(0, height).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${randomBetween(0.8, 1.8).toFixed(1)}" fill="${pick(palette)}" fill-opacity="0.3"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha"><rect width="${width}" height="${height}" fill="#f8fafc"/>${lines}${dots}${glyphs}</svg>`;
};

// 签发新挑战：返回 { captchaId, svg }。
export const issueCaptcha = () => {
  const now = Date.now();
  prune(now);
  let answer = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) answer += pick(CHARSET.split(''));
  const captchaId = crypto.randomUUID();
  store.set(captchaId, { answer, expiresAt: now + TTL_MS });
  return { captchaId, svg: renderSvg(answer) };
};

// 校验：单次有效（无论成败即消费）。'ok' | 'invalid' | 'required'
export const verifyCaptcha = (captchaId, text) => {
  if (typeof captchaId !== 'string' || typeof text !== 'string' || !captchaId || !text.trim()) {
    return 'required';
  }
  const entry = store.get(captchaId);
  store.delete(captchaId);
  if (!entry || entry.expiresAt <= Date.now()) return 'invalid';
  return text.trim().toLowerCase() === entry.answer ? 'ok' : 'invalid';
};

// 测试专用：读答案（不经 HTTP 泄漏，仅服务端内部使用）。
export const _peekAnswer = (captchaId) => store.get(captchaId)?.answer ?? null;

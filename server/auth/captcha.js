// Self-hosted SVG captcha for login/register bot friction.
// Zero dependencies: hand-rolled distorted-glyph SVG + in-memory single-use
// store. CAPTCHA_ENABLED is read per-request (not at import) so tests and
// staged rollouts can toggle it via env; production .env sets it to 'true'.
import crypto from 'node:crypto';
import { getGlyphPaths, ALL_GLYPHS } from './glyphPaths.js';

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

// 渲染扭曲字形为 SVG path（无 <text> 元素，答案不以明文出现）
const renderSvg = (code) => {
  const width = 132;
  const height = 44;
  const palette = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c'];
  const step = width / (CODE_LENGTH + 1);

  // 全局扰动滤镜：破坏骨架匹配
  const filterDef = `
    <filter id="w" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  `;

  const glyphs = code
    .split('')
    .map((ch, i) => {
      const paths = getGlyphPaths(ch);
      if (paths.length === 0) return '';
      const cx = step * (i + 0.6) + randomBetween(-1, 1);
      const cy = height / 2 + randomBetween(0, 4);
      const rotate = randomBetween(-22, 22).toFixed(1);
      const scale = randomBetween(0.85, 1.15).toFixed(2);
      const skew = randomBetween(-6, 6).toFixed(1);
      const color = pick(palette);
      const strokeWidth = randomBetween(2.0, 2.8).toFixed(1);

      const pathData = paths
        .map(p => {
          // 将 0..100 坐标映射到字形局部坐标系（约 40x40）
          return p
            .replace(/M(\d+) (\d+)/g, (_m, x, y) => `M${(x - 50) * 0.4} ${(y - 50) * 0.4}`)
            .replace(/L(\d+) (\d+)/g, (_m, x, y) => `L${(x - 50) * 0.4} ${(y - 50) * 0.4}`)
            .replace(/C(\d+) (\d+) (\d+) (\d+) (\d+) (\d+)/g,
              (_m, x1, y1, x2, y2, x, y) =>
                `C${(x1 - 50) * 0.4} ${(y1 - 50) * 0.4} ${(x2 - 50) * 0.4} ${(y2 - 50) * 0.4} ${(x - 50) * 0.4} ${(y - 50) * 0.4}`)
            .replace(/Z/g, 'Z');
        })
        .join(' ');

      return `
        <g
          transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rotate}) scale(${scale}) skewX(${skew})"
          fill="none"
          stroke="${color}"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
          stroke-linejoin="round"
          filter="url(#w)"
        >
          <path d="${pathData}"/>
        </g>
      `;
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">${filterDef}<rect width="${width}" height="${height}" fill="#f8fafc"/>${lines}${dots}${glyphs}</svg>`;
};

// 签发新挑战：返回 { captchaId, svg }。
export const issueCaptcha = () => {
  const now = Date.now();
  prune(now);
  let answer = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) answer += pick(ALL_GLYPHS);
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
/**
 * Server 端环境变量配置
 * ESM 模块，供 server/ 目录下使用
 */

const DEFAULTS = {
  SERVER_PORT: 3001,
  API_HOST: 'localhost',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  NODE_ENV: 'development',
  COOKIE_SECURE: false,
  CAPTCHA_ENABLED: false,
  EMAIL_VERIFICATION_DISABLED: false,
  RATE_LIMIT_DISABLED: false,
};

function getEnv(key, fallback) {
  if (process.env[key]) return process.env[key];
  return fallback;
}

function getEnvInt(key, fallback) {
  const val = getEnv(key, String(fallback));
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getEnvBool(key, fallback) {
  const val = getEnv(key, String(fallback)).toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

export const SERVER_CONFIG = {
  PORT: getEnvInt('SERVER_PORT', DEFAULTS.SERVER_PORT),
  API_HOST: getEnv('API_HOST', DEFAULTS.API_HOST),
  DB_HOST: getEnv('DB_HOST', DEFAULTS.DB_HOST),
  DB_PORT: getEnvInt('DB_PORT', DEFAULTS.DB_PORT),
  NODE_ENV: getEnv('NODE_ENV', DEFAULTS.NODE_ENV),
  IS_PRODUCTION: getEnv('NODE_ENV', DEFAULTS.NODE_ENV) === 'production',
  COOKIE_SECURE: getEnvBool('COOKIE_SECURE', DEFAULTS.COOKIE_SECURE),
  CAPTCHA_ENABLED: getEnvBool('CAPTCHA_ENABLED', DEFAULTS.CAPTCHA_ENABLED),
  EMAIL_VERIFICATION_DISABLED: getEnvBool('EMAIL_VERIFICATION_DISABLED', DEFAULTS.EMAIL_VERIFICATION_DISABLED),
  RATE_LIMIT_DISABLED: getEnvBool('RATE_LIMIT_DISABLED', DEFAULTS.RATE_LIMIT_DISABLED),
};

export function getAllowedOrigins() {
  const corsOrigins = process.env.CORS_ORIGINS;
  if (corsOrigins) {
    return corsOrigins.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (SERVER_CONFIG.IS_PRODUCTION) return [];
  return [
    `http://localhost:3000`,
    `http://localhost:5173`,
    `http://localhost:${3005}`, // 兼容旧端口
  ];
}

export function validateProductionConfig() {
  if (!SERVER_CONFIG.IS_PRODUCTION) return { valid: true, errors: [] };
  
  const errors = [];
  
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl || !publicAppUrl.startsWith('https://')) {
    errors.push('PUBLIC_APP_URL 必须是 https:// 生产域名');
  }
  
  const corsOrigins = process.env.CORS_ORIGINS;
  if (!corsOrigins || !corsOrigins.startsWith('https://')) {
    errors.push('CORS_ORIGINS 必须包含 https:// 生产域名');
  }
  
  if (SERVER_CONFIG.COOKIE_SECURE !== true) {
    errors.push('生产环境必须 COOKIE_SECURE=true');
  }
  
  if (SERVER_CONFIG.EMAIL_VERIFICATION_DISABLED === true) {
    errors.push('生产环境必须 EMAIL_VERIFICATION_DISABLED=false');
  }
  
  if (SERVER_CONFIG.RATE_LIMIT_DISABLED === true) {
    errors.push('生产环境必须 RATE_LIMIT_DISABLED=false');
  }
  
  const hex64 = /^[0-9a-f]{64}$/i;
  const requiredKeys = [
    'MODEL_ENC_KEY',
    'REQUEST_HMAC_KEY',
    'EMAIL_DELIVERY_KEY',
    'IP_HMAC_SALT',
    'POSTGRES_PASSWORD',
  ];
  
  for (const key of requiredKeys) {
    const val = process.env[key];
    if (!val) {
      errors.push(`缺少必需环境变量: ${key}`);
    } else if (!hex64.test(val)) {
      errors.push(`${key} 必须是 64 位十六进制字符串 (openssl rand -hex 32)`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}
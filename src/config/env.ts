/**
 * 统一环境变量配置模块
 * 
 * 消除代码中散落的硬编码端口/URL，统一通过环境变量注入。
 * 优先级：process.env > import.meta.env (Vite) > 默认值
 * 
 * 用法：
 * import { ENV } from './config/env';
 * console.log(ENV.API_PORT); // 3001
 */

// ===== 通用默认值 =====
const DEFAULTS = {
  // 端口
  API_PORT: 3001,
  VITE_DEV_PORT: 3000,
  FRONTEND_PORT: 3005,
  ELECTRON_PORT: 39628,
  DB_PORT: 5432,
  
  // 主机
  API_HOST: 'localhost',
  DB_HOST: 'localhost',
  
  // URL 基础
  API_BASE_PATH: '/api',
  PUBLIC_APP_URL: '',
  CORS_ORIGINS: '',
  
  // 模式
  NODE_ENV: 'development',
  
  // 安全
  COOKIE_SECURE: false,
  CAPTCHA_ENABLED: false,
  EMAIL_VERIFICATION_DISABLED: false,
  RATE_LIMIT_DISABLED: false,
} as const;

// ===== 获取环境变量（支持多种前缀）=====
function getEnv(key: string, fallback: string): string {
  // 1. 标准 process.env
  if (process.env[key]) return process.env[key];
  
  // 2. Vite import.meta.env (客户端)
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  
  // 3. Vite 兼容前缀 VITE_
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[`VITE_${key}`]) {
    return import.meta.env[`VITE_${key}`];
  }
  
  return fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const val = getEnv(key, String(fallback));
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = getEnv(key, String(fallback)).toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

// ===== 导出统一配置对象 =====
export const ENV = {
  // ===== 端口 =====
  API_PORT: getEnvInt('SERVER_PORT', DEFAULTS.API_PORT),
  API_HOST: getEnv('API_HOST', DEFAULTS.API_HOST),
  VITE_DEV_PORT: getEnvInt('VITE_DEV_PORT', DEFAULTS.VITE_DEV_PORT),
  FRONTEND_PORT: getEnvInt('PUBLIC_PORT', DEFAULTS.FRONTEND_PORT),
  ELECTRON_PORT: getEnvInt('ELECTRON_PORT', DEFAULTS.ELECTRON_PORT),
  DB_PORT: getEnvInt('DB_PORT', DEFAULTS.DB_PORT),
  DB_HOST: getEnv('DB_HOST', DEFAULTS.DB_HOST),
  
  // ===== URL =====
  API_BASE_PATH: getEnv('API_BASE_PATH', DEFAULTS.API_BASE_PATH),
  PUBLIC_APP_URL: getEnv('PUBLIC_APP_URL', DEFAULTS.PUBLIC_APP_URL),
  CORS_ORIGINS: getEnv('CORS_ORIGINS', DEFAULTS.CORS_ORIGINS),
  
  // ===== 模式 =====
  NODE_ENV: getEnv('NODE_ENV', DEFAULTS.NODE_ENV),
  IS_PRODUCTION: getEnv('NODE_ENV', DEFAULTS.NODE_ENV) === 'production',
  IS_DEVELOPMENT: getEnv('NODE_ENV', DEFAULTS.NODE_ENV) === 'development',
  
  // ===== 安全开关 =====
  COOKIE_SECURE: getEnvBool('COOKIE_SECURE', DEFAULTS.COOKIE_SECURE),
  CAPTCHA_ENABLED: getEnvBool('CAPTCHA_ENABLED', DEFAULTS.CAPTCHA_ENABLED),
  EMAIL_VERIFICATION_DISABLED: getEnvBool('EMAIL_VERIFICATION_DISABLED', DEFAULTS.EMAIL_VERIFICATION_DISABLED),
  RATE_LIMIT_DISABLED: getEnvBool('RATE_LIMIT_DISABLED', DEFAULTS.RATE_LIMIT_DISABLED),
  
  // ===== 计算属性 =====
  get API_BASE_URL() {
    const scheme = this.IS_PRODUCTION ? 'https' : 'http';
    const host = this.PUBLIC_APP_URL 
      ? new URL(this.PUBLIC_APP_URL).host 
      : `${this.API_HOST}:${this.API_PORT}`;
    return `${scheme}://${host}${this.API_BASE_PATH}`;
  },
  
  get FRONTEND_URL() {
    if (this.PUBLIC_APP_URL) return this.PUBLIC_APP_URL;
    const scheme = this.IS_PRODUCTION ? 'https' : 'http';
    return `${scheme}://${this.API_HOST}:${this.FRONTEND_PORT}`;
  },
  
  get CORS_ORIGIN_LIST() {
    return this.CORS_ORIGINS
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  },
  
  get ALLOWED_ORIGINS() {
    if (this.IS_PRODUCTION) {
      return this.CORS_ORIGIN_LIST;
    }
    // 开发环境默认允许
    return [
      ...this.CORS_ORIGIN_LIST,
      `http://localhost:${this.VITE_DEV_PORT}`,
      `http://localhost:${this.FRONTEND_PORT}`,
      `http://127.0.0.1:${this.VITE_DEV_PORT}`,
      `http://127.0.0.1:${this.FRONTEND_PORT}`,
    ];
  },
} as const;

// ===== 类型导出 =====
export type EnvConfig = typeof ENV;

// ===== 验证函数（生产环境必填）=====
export function validateProductionEnv(): { valid: boolean; errors: string[] } {
  if (!ENV.IS_PRODUCTION) return { valid: true, errors: [] };
  
  const errors: string[] = [];
  
  if (!ENV.PUBLIC_APP_URL || !ENV.PUBLIC_APP_URL.startsWith('https://')) {
    errors.push('PUBLIC_APP_URL 必须是 https:// 生产域名');
  }
  
  if (!ENV.CORS_ORIGINS || !ENV.CORS_ORIGINS.startsWith('https://')) {
    errors.push('CORS_ORIGINS 必须包含 https:// 生产域名');
  }
  
  if (ENV.COOKIE_SECURE !== true) {
    errors.push('生产环境必须 COOKIE_SECURE=true');
  }
  
  if (ENV.EMAIL_VERIFICATION_DISABLED === true) {
    errors.push('生产环境必须 EMAIL_VERIFICATION_DISABLED=false');
  }
  
  if (ENV.RATE_LIMIT_DISABLED === true) {
    errors.push('生产环境必须 RATE_LIMIT_DISABLED=false');
  }
  
  // 密钥格式校验（可选：要求 64 位 hex）
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

// ===== 开发环境便捷 =====
export function getDevServerProxyConfig() {
  return {
    target: `http://${ENV.API_HOST}:${ENV.API_PORT}`,
    changeOrigin: true,
  };
}

export function getViteServerConfig() {
  return {
    port: ENV.VITE_DEV_PORT,
    host: '0.0.0.0' as const,
    proxy: {
      [ENV.API_BASE_PATH]: getDevServerProxyConfig(),
    },
  };
}

export function getElectronServerConfig() {
  return {
    port: ENV.ELECTRON_PORT,
    host: '127.0.0.1' as const,
  };
}
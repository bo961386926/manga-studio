// Minimal auth client for the browser: login/logout/me/csrf over same-origin
// cookies. The CSRF token lives only in memory via storageService.
import { apiFetch, setCsrfToken } from './storageService';

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  status: string;
}

export const fetchMe = async (): Promise<SessionUser | null> => {
  try {
    return await apiFetch('/auth/me');
  } catch {
    return null;
  }
};

export const login = async (email: string, password: string): Promise<SessionUser> => {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error('登录尝试过于频繁，请稍后再试');
    if (res.status === 403) throw new Error('登录请求被服务器拒绝，请检查本地服务来源配置');
    if (res.status >= 500) throw new Error('登录服务暂时不可用，请稍后再试');
    throw new Error('邮箱或密码不正确');
  }
  const body = await res.json();
  setCsrfToken(body.csrfToken);
  return body.user as SessionUser;
};

export const refreshCsrf = async (): Promise<string | undefined> => {
  try {
    const body = await apiFetch('/auth/csrf');
    setCsrfToken(body.csrfToken);
    return body.csrfToken;
  } catch {
    return undefined;
  }
};

export const logout = async (): Promise<void> => {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    setCsrfToken(undefined);
  }
};

export const changePassword = async (
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const body = await apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  setCsrfToken(body.csrfToken);
};

export const register = async (email: string, password: string): Promise<void> => {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '注册失败');
  }
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  const res = await fetch('/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error('请求失败，请稍后重试');
};

export const verifyEmail = async (token: string): Promise<void> => {
  const res = await fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error('验证链接无效或已过期');
};

export const resetPassword = async (token: string, password: string): Promise<void> => {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) throw new Error('重置失败，链接可能已过期');
};

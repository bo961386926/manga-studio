import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePassword, login } from '../services/authClient';
import { getCsrfToken, setCsrfToken } from '../services/storageService';

describe('authenticated password change client', () => {
  afterEach(() => {
    setCsrfToken(undefined);
    vi.unstubAllGlobals();
  });

  it('posts both passwords and stores the replacement CSRF token', async () => {
    setCsrfToken('old-csrf');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, csrfToken: 'replacement-csrf' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await changePassword('current-password', 'new-password-123');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/change-password', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current-password',
        newPassword: 'new-password-123',
      }),
      headers: expect.objectContaining({ 'X-CSRF-Token': 'old-csrf' }),
    }));
    expect(getCsrfToken()).toBe('replacement-csrf');
  });

  it('reports login rate limiting instead of claiming the password is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    })));

    await expect(login('admin@localhost', 'password')).rejects.toThrow(
      '登录尝试过于频繁，请稍后再试'
    );
  });

  it('reports a rejected browser origin instead of claiming the password is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'origin not allowed' }),
    })));

    await expect(login('admin@localhost', 'password')).rejects.toThrow(
      '登录请求被服务器拒绝，请检查本地服务来源配置'
    );
  });
});

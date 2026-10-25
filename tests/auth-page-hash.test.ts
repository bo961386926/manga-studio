// TDD RED-first: AuthPage 的 hash→动作解析必须认识 #/bootstrap?token=…，
// 否则管理员激活链接只会落到登录页（2026-10-12 生产缺陷）。
import { describe, it, expect } from 'vitest';
import { parseHashAction } from '../components/AuthPage/hashAction';

describe('parseHashAction', () => {
  it('识别 #/bootstrap?token=… 为激活管理员动作', () => {
    expect(parseHashAction('#/bootstrap?token=abc123DEF-_')).toEqual({
      kind: 'bootstrap',
      token: 'abc123DEF-_',
    });
  });

  it('识别 #/verify-email?token=… 为邮箱验证动作（优先）', () => {
    expect(parseHashAction('#/verify-email?token=tok_1')).toEqual({
      kind: 'verify',
      token: 'tok_1',
    });
  });

  it('识别 #/reset-password?token=… 为重置密码动作', () => {
    expect(parseHashAction('#/reset-password?token=rst-9')).toEqual({
      kind: 'reset',
      token: 'rst-9',
    });
  });

  it('未知 hash 与空 hash 返回 none（不误触发）', () => {
    expect(parseHashAction('#/login')).toEqual({ kind: 'none' });
    expect(parseHashAction('')).toEqual({ kind: 'none' });
  });

  it('token 缺失时不算命中（避免空 token 进表单）', () => {
    expect(parseHashAction('#/bootstrap?token=')).toEqual({ kind: 'none' });
    expect(parseHashAction('#/bootstrap')).toEqual({ kind: 'none' });
  });
});

// AuthPage 的 hash→动作解析（纯函数，便于无 jsdom 单测）。
// 支持：#/verify-email?token=…（自动验证）、#/bootstrap?token=…（首管理员激活）、
// #/reset-password?token=…（设置新密码）。其余一律 none，由页面回退登录表单。
export type HashAction =
  | { kind: 'none' }
  | { kind: 'verify'; token: string }
  | { kind: 'reset'; token: string }
  | { kind: 'bootstrap'; token: string };

const TOKEN_RE = (name: string) => new RegExp(`^#/${name}\\?token=([A-Za-z0-9\\-_]+)`);

export function parseHashAction(hash: string): HashAction {
  const tokenOf = (name: string): string => {
    const m = hash.match(TOKEN_RE(name));
    return m ? m[1] : '';
  };
  const verifyToken = tokenOf('verify-email');
  if (verifyToken) return { kind: 'verify', token: verifyToken };
  const bootstrapToken = tokenOf('bootstrap');
  if (bootstrapToken) return { kind: 'bootstrap', token: bootstrapToken };
  const resetToken = tokenOf('reset-password');
  if (resetToken) return { kind: 'reset', token: resetToken };
  return { kind: 'none' };
}

// cookieOptions must honor an explicit COOKIE_SECURE env override so that
// transitional HTTP deployments (certificate still being issued) can keep
// sessions working, while the default behavior is unchanged:
//   - NODE_ENV=production without COOKIE_SECURE  -> secure: true (as before)
//   - NODE_ENV=production, COOKIE_SECURE=false   -> secure: false (transitional)
//   - COOKIE_SECURE=true in any environment      -> secure: true
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cookieOptions } from '../auth/session.js';

function withEnv(env, fn) {
  const keys = ['NODE_ENV', 'COOKIE_SECURE'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('cookieOptions COOKIE_SECURE override', () => {
  test('production without explicit COOKIE_SECURE stays secure (default unchanged)', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      assert.equal(cookieOptions().secure, true);
    });
  });

  test('production with COOKIE_SECURE=false disables Secure for transitional HTTP', () => {
    withEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }, () => {
      assert.equal(cookieOptions().secure, false);
    });
  });

  test('COOKIE_SECURE=true forces Secure even outside production', () => {
    withEnv({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }, () => {
      assert.equal(cookieOptions().secure, true);
    });
  });

  test('non-production without COOKIE_SECURE remains non-secure (dev over http)', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
      assert.equal(cookieOptions().secure, false);
    });
  });

  test('other cookie attributes are preserved', () => {
    withEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }, () => {
      const opts = cookieOptions();
      assert.equal(opts.httpOnly, true);
      assert.equal(opts.sameSite, 'lax');
      assert.equal(opts.path, '/');
    });
  });
});

// 备份加密模块单测（TDD）：BACKUP_AGE_RECIPIENT 设置后，
// pg_dump 产物必须被 age 加密成 .dump.age 且明文被删除；
// age 缺失/失败时必须整体失败（绝不留下明文伪装成功）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { encryptBackup } from '../scripts/backup-encrypt.js';

describe('encryptBackup', () => {
  let dir;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-enc-'));
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('calls age with recipient and output file, removes plaintext on success', () => {
    const plain = path.join(dir, 'manga_studio-20260929-010101.dump');
    fs.writeFileSync(plain, 'fake pg_dump payload');
    const calls = [];
    const runner = (bin, args) => {
      calls.push({ bin, args });
      // 模拟 age 成功产出加密文件
      const outIdx = args.indexOf('-o');
      fs.writeFileSync(args[outIdx + 1], 'ciphertext');
    };

    const out = encryptBackup(plain, 'age1test recipient', runner);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'age');
    assert.deepEqual(calls[0].args, ['-r', 'age1test recipient', '-o', `${plain}.age`, plain]);
    assert.equal(out, `${plain}.age`);
    assert.equal(fs.existsSync(plain), false, 'plaintext must be removed after successful encryption');
    assert.equal(fs.existsSync(`${plain}.age`), true);
  });

  test('propagates failure when age exits non-zero (keeps failing loudly)', () => {
    const plain = path.join(dir, 'db.dump');
    fs.writeFileSync(plain, 'payload');
    const runner = () => {
      throw new Error('age: exec format error');
    };

    assert.throws(() => encryptBackup(plain, 'age1test', runner), /age/);
    // 失败时明文保留，但调用方（backup-db.js）会以非零退出并记录 FAILED
    assert.equal(fs.existsSync(plain), true);
  });

  test('rejects empty recipient (misconfiguration must not silently skip encryption)', () => {
    const plain = path.join(dir, 'db.dump');
    fs.writeFileSync(plain, 'payload');

    assert.throws(() => encryptBackup(plain, '   ', () => {}), /recipient/i);
  });
});

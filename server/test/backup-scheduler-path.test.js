// 自动备份调度路径单测：server/backup.js 定时 spawn 的 backup-db.js
// 必须解析到真实存在的文件（回归防护：2026-09-29 脚本迁入 server/scripts/
// 后，旧相对路径 <repo>/scripts/backup-db.js 在宿主与容器内双双失效）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getBackupScriptPath } from '../backup.js';

describe('backup scheduler script path', () => {
  test('resolves to server/scripts/backup-db.js and the file exists', () => {
    const p = getBackupScriptPath();
    assert.equal(path.basename(p), 'backup-db.js');
    assert.ok(
      p.includes(path.join('scripts', 'backup-db.js')),
      `unexpected layout: ${p}`
    );
    assert.ok(fs.existsSync(p), `scheduled backup script missing on disk: ${p}`);
  });
});

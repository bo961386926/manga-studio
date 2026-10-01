// pg_dump 产物加密：用 age 公钥加密备份文件（对称于部署手册的 BACKUP_AGE_RECIPIENT 开关）。
// 设计原则：
//  - recipient 为空/空白 → 直接抛错（配置了开关却空值 = 误配置，绝不能静默跳过加密）；
//  - age 失败 → 原样抛错，由调用方以非零退出并记录 FAILED（绝不留下明文伪装成功）；
//  - runner 可注入（测试用），默认 execFileSync('age', ...)。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const encryptBackup = (plainFile, recipient, runner) => {
  if (!recipient || !String(recipient).trim()) {
    throw new Error('backup encryption: BACKUP_AGE_RECIPIENT is empty');
  }
  const run = runner || ((bin, args) => execFileSync(bin, args, { stdio: 'inherit' }));
  const outFile = `${plainFile}.age`;
  run('age', ['-r', String(recipient).trim(), '-o', outFile, plainFile]);
  fs.rmSync(plainFile, { force: true });
  return outFile;
};

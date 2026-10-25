// pg_dump 产物加密：用 age 公钥加密备份文件（对称于部署手册的 BACKUP_AGE_RECIPIENT 开关）。
// 设计原则：
//  - recipient 为空/空白 → 直接抛错（配置了开关却空值 = 误配置，绝不能静默跳过加密）；
//  - age 加密失败 → 原样抛错，调用方清理残留并非零退出；
//  - 加密成功后，验证可解密（age -d 试运行），验证通过才删除明文；
//  - runner 可注入（测试用），默认 execFileSync('age', ...)。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const encryptBackup = (plainFile, recipient, runner) => {
  if (!recipient || !String(recipient).trim()) {
    throw new Error('backup encryption: BACKUP_AGE_RECIPIENT is empty');
  }
  const run = runner || ((bin, args) => execFileSync(bin, args, { stdio: 'inherit' }));
  const outFile = `${plainFile}.age`;

  // 加密
  run('age', ['-r', String(recipient).trim(), '-o', outFile, plainFile]);

  // 验证可解密（不写出文件，只试解密到 /dev/null）
  try {
    run('age', ['-d', '-r', String(recipient).trim(), '-o', '/dev/null', outFile]);
  } catch (verifyErr) {
    // 验证失败：删除生成的 .age 文件，保留明文供人工排查，抛错
    try { fs.rmSync(outFile, { force: true }); } catch {}
    throw new Error(`backup encryption verify failed: ${verifyErr.message}`);
  }

  // 验证通过 → 删除明文
  fs.rmSync(plainFile, { force: true });
  return outFile;
};
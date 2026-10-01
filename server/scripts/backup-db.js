// Database backup: pg_dump the whole manga_studio database to backups/ and
// keep the newest BACKUP_KEEP snapshots (default 14). Also callable as
// `npm run backup` for a manual snapshot.
//
// BACKUP_DIR 默认取当前工作目录下的 backups/：
//   - 仓库根 `npm run backup`（cwd=仓库根）→ <repo>/backups/
//   - 容器内调度（server/backup.js spawn，cwd=/app，compose 挂载 backups 卷）→ /app/backups/
// BACKUP_AGE_RECIPIENT（age 公钥）设置后，备份自动加密为 .dump.age 并删除明文；
// 加密失败整体失败，绝不留下明文伪装成功。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { encryptBackup } from './backup-encrypt.js';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP || '14', 10);

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const run = () => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dbName = process.env.DB_NAME || 'manga_studio';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || '5432';
  const dbUser = process.env.DB_USER || 'postgres';
  const file = path.join(BACKUP_DIR, `${dbName}-${stamp()}.dump`);

  const args = [
    '--host', dbHost,
    '--port', dbPort,
    '--username', dbUser,
    '--dbname', dbName,
    '--format', 'custom',
    '--file', file,
  ];
  const env = { ...process.env };
  if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;

  execFileSync('pg_dump', args, { env, stdio: 'inherit' });
  const sizeMB = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  console.log(`[backup] OK: ${file} (${sizeMB} MB)`);

  // 可选加密：设置 BACKUP_AGE_RECIPIENT 时用 age 公钥加密，成功后删除明文。
  let finalFile = file;
  const recipient = process.env.BACKUP_AGE_RECIPIENT;
  if (recipient && recipient.trim()) {
    finalFile = encryptBackup(file, recipient);
    const encMB = (fs.statSync(finalFile).size / 1024 / 1024).toFixed(2);
    console.log(`[backup] encrypted: ${finalFile} (${encMB} MB)`);
  } else {
    console.warn('[backup] WARNING: BACKUP_AGE_RECIPIENT not set — backup stored as PLAINTEXT (contains user PII)');
  }

  // Rotate: keep only the newest KEEP files (plain or encrypted).
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump') || f.endsWith('.dump.age'))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log(`[backup] pruned: ${old}`);
  }
  return finalFile;
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  try {
    run();
  } catch (err) {
    console.error('[backup] FAILED:', err.message);
    process.exit(1);
  }
}

export default run;

// Scheduled database backups. Runs scripts/backup-db.js (next to this file,
// packaged into the api image at /app/scripts/) on an interval
// (BACKUP_INTERVAL_HOURS, default 24) in an unref'd timer so it never blocks
// shutdown. The first backup runs after BACKUP_INITIAL_DELAY_MS (default 10
// minutes) so a fresh server doesn't backup mid-startup.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 脚本与本文件同目录下的 scripts/backup-db.js（仓库布局与容器布局一致，
// 均为 <server>/scripts/backup-db.js；历史相对路径 <repo>/scripts 已随脚本
// 迁移失效，见 test/backup-scheduler-path.test.js 回归防护）。
export const getBackupScriptPath = () => path.join(__dirname, 'scripts', 'backup-db.js');

export const startBackupScheduler = () => {
  if (process.env.BACKUP_DISABLED === 'true') return null;
  const intervalMs = parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000;
  const initialDelayMs = parseInt(process.env.BACKUP_INITIAL_DELAY_MS || String(10 * 60 * 1000), 10);

  const runOnce = () => {
    const child = spawn(process.execPath, [getBackupScriptPath()], {
      cwd: __dirname,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', (err) => console.error('[backup] spawn error:', err.message));
  };

  const timer = setInterval(runOnce, intervalMs);
  timer.unref();
  const first = setTimeout(runOnce, initialDelayMs);
  first.unref();
  console.log(`[backup] scheduler active: every ${intervalMs / 3600000}h (first in ${initialDelayMs / 60000}min)`);
  return { timer, first };
};

// Scheduled database backups. Runs scripts/backup-db.js on an interval
// (BACKUP_INTERVAL_HOURS, default 24) in an unref'd timer so it never blocks
// shutdown. The first backup runs after BACKUP_INITIAL_DELAY_MS (default 10
// minutes) so a fresh server doesn't backup mid-startup.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const startBackupScheduler = () => {
  if (process.env.BACKUP_DISABLED === 'true') return null;
  const intervalMs = parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000;
  const initialDelayMs = parseInt(process.env.BACKUP_INITIAL_DELAY_MS || String(10 * 60 * 1000), 10);

  const runOnce = () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'backup-db.js')], {
      cwd: ROOT,
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

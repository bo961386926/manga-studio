// Database backup: pg_dump the whole manga_studio database to backups/ and
// keep the newest BACKUP_KEEP snapshots (default 14). Also callable as
// `npm run backup` for a manual snapshot.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
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

  // Rotate: keep only the newest KEEP files.
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log(`[backup] pruned: ${old}`);
  }
  return file;
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

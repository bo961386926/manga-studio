#!/usr/bin/env bash
# 手动立即备份：调用 api 容器内置的 scripts/backup-db.js（与定时调度同一实现，
# 同样尊重 BACKUP_KEEP 轮换与 BACKUP_AGE_RECIPIENT 加密）。
# 用法：./scripts/backup-now.sh
set -euo pipefail
cd "$(dirname "$0")/.."

API_CONTAINER=manga-studio-api

echo "[backup-now] 在 $API_CONTAINER 内执行备份…"
docker exec -w /app "$API_CONTAINER" node scripts/backup-db.js

echo "[backup-now] 最近 3 份备份："
docker exec "$API_CONTAINER" sh -c 'ls -lt /app/backups 2>/dev/null | head -4' || true

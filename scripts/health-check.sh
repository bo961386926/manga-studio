#!/usr/bin/env bash
# 上线体检：容器 / API / 前端 / 数据库 / 迁移 / 备份新鲜度 / 磁盘，全绿才退出 0。
# 用法：./scripts/health-check.sh   （可用于 cron 告警）
set -uo pipefail
cd "$(dirname "$0")/.."

API_CONTAINER=manga-studio-api
APP_CONTAINER=manga-studio-app
DB_CONTAINER=manga-studio-db
PUBLIC_PORT="${PUBLIC_PORT:-3005}"

pass=0; fail=0
chk() { # chk <名称> <命令...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '\033[1;32m[PASS]\033[0m %s\n' "$name"; pass=$((pass+1))
  else
    printf '\033[1;31m[FAIL]\033[0m %s\n' "$name"; fail=$((fail+1))
  fi
}

# 1. 容器状态（helper 返回布尔，避免在 chk 管道里吞掉 [PASS] 输出）
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; }
chk "容器 $API_CONTAINER 运行中"  running "$API_CONTAINER"
chk "容器 $APP_CONTAINER 运行中"  running "$APP_CONTAINER"
chk "容器 $DB_CONTAINER 运行中"   running "$DB_CONTAINER"
chk "API 容器健康检查 healthy"    healthy "$API_CONTAINER"

# 2. HTTP 冒烟（经 frontend nginx 反代）
chk "GET /api/health → 200"       curl -fsS "http://localhost:${PUBLIC_PORT}/api/health"
chk "GET / （前端）→ 200"         curl -fsS -o /dev/null "http://localhost:${PUBLIC_PORT}/"

# 3. 数据库连通 + 迁移版本
chk "DB 可查询（SELECT 1）"       docker exec "$DB_CONTAINER" psql -U postgres -d manga_studio -tAc 'SELECT 1'
mig=$(docker exec "$DB_CONTAINER" psql -U postgres -d manga_studio -tAc 'SELECT count(*) FROM schema_migrations' 2>/dev/null || echo 0)
if [ "${mig:-0}" -ge 1 ] 2>/dev/null; then
  printf '\033[1;32m[PASS]\033[0m 迁移已应用（schema_migrations=%s）\n' "$mig"; pass=$((pass+1))
else
  printf '\033[1;31m[FAIL]\033[0m 迁移记录为空（schema_migrations=%s）\n' "$mig"; fail=$((fail+1))
fi

# 4. 备份新鲜度（内置调度器写入 /app/backups）
latest=$(docker exec "$API_CONTAINER" sh -c 'ls -t /app/backups 2>/dev/null | head -1' 2>/dev/null || true)
if [ -n "$latest" ]; then
  mtime=$(docker exec "$API_CONTAINER" sh -c "stat -c %Y \"/app/backups/$latest\"" 2>/dev/null || echo 0)
  age_h=$(( ($(date +%s) - mtime) / 3600 ))
  if [ "$age_h" -le 26 ]; then
    printf '\033[1;32m[PASS]\033[0m 最新备份 %s（%s 小时前）\n' "$latest" "$age_h"; pass=$((pass+1))
  else
    printf '\033[1;31m[FAIL]\033[0m 最新备份 %s 已 %s 小时（>26h，检查调度器）\n' "$latest" "$age_h"; fail=$((fail+1))
  fi
else
  printf '\033[1;33m[WARN]\033[0m 暂无备份（新部署 10 分钟后出第一份；可立即: ./scripts/backup-now.sh）\n'
fi

# 5. 磁盘余量
disk_free=$(df -P / | awk 'NR==2 {gsub("%","",$5); print 100-$5}')
if [ "${disk_free:-0}" -ge 15 ]; then
  printf '\033[1;32m[PASS]\033[0m 根分区剩余 %s%%\n' "$disk_free"; pass=$((pass+1))
else
  printf '\033[1;31m[FAIL]\033[0m 根分区仅剩 %s%%（<15%%）\n' "$disk_free"; fail=$((fail+1))
fi

printf '\n体检结果: %s 项通过, %s 项失败\n' "$pass" "$fail"
[ "$fail" -eq 0 ] && exit 0 || exit 1

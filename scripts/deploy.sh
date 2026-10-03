#!/usr/bin/env bash
# 一键部署：预检 .env 生产门 → 构建镜像 → 起容器 → 等健康 → 冒烟验证。
# 失败时自动回滚到 :previous 镜像（首次部署无 previous 则只报错不回滚）。
#
# 用法：./scripts/deploy.sh [--skip-preflight]
# 前提：仓库根有 .env（生产值），Docker 与 docker compose v2 可用。
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose --env-file .env"
API_CONTAINER=manga-studio-api
APP_CONTAINER=manga-studio-app
PUBLIC_PORT="${PUBLIC_PORT:-3005}"   # frontend nginx 宿主端口（见 compose）
SKIP_PREFLIGHT=false
PREFLIGHT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --skip-preflight) SKIP_PREFLIGHT=true ;;
    --preflight-only) PREFLIGHT_ONLY=true ;;
  esac
done

say()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 预检：生产 env 门 ----------
if [ "$SKIP_PREFLIGHT" = false ]; then
  say "预检 .env 生产门…"
  [ -f .env ] || die "缺 .env（参考 .env.production.example）"
  # shellcheck disable=SC1091
  set -a; source .env; set +a

  need() { [ -n "${!1:-}" ] || die ".env 缺必填项 $1"; }
  need POSTGRES_PASSWORD; need CORS_ORIGINS; need PUBLIC_APP_URL
  need MODEL_ENC_KEY
  [ -n "${REQUEST_HMAC_KEY:-}" ] || die ".env 缺必填项 REQUEST_HMAC_KEY（服务端 fail-close）"

  case "$CORS_ORIGINS" in https://*) ok "CORS_ORIGINS=$CORS_ORIGINS";; *) die "CORS_ORIGINS 必须是 https:// 源，当前: ${CORS_ORIGINS:-空}";; esac

  grep -q '^NODE_ENV=production' .env || die ".env 必须显式 NODE_ENV=production"
  grep -q '^EMAIL_VERIFICATION_DISABLED=false' .env || die "生产必须 EMAIL_VERIFICATION_DISABLED=false（邮箱验证不可旁路）"
  grep -q '^RATE_LIMIT_DISABLED=false' .env || die "生产必须 RATE_LIMIT_DISABLED=false（限流不可旁路）"
  [ "${#POSTGRES_PASSWORD}" -ge 12 ] || die "POSTGRES_PASSWORD 至少 12 位"
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || say "警告：未设 BACKUP_AGE_RECIPIENT，备份将明文存储（含 PII，强烈建议 age 加密）"
  ok "预检通过"
  [ "$PREFLIGHT_ONLY" = true ] && { ok "--preflight-only：到此为止，不构建不部署"; exit 0; }
fi

# ---------- 2. 构建与回滚锚点 ----------
say "记录回滚锚点（:previous 镜像，若存在）…"
docker image inspect manga-studio-api:latest >/dev/null 2>&1 \
  && docker tag manga-studio-api:latest manga-studio-api:previous || true
docker image inspect manga-studio:latest >/dev/null 2>&1 \
  && docker tag manga-studio:latest manga-studio:previous || true

rollback() {
  say "部署失败，尝试回滚 :previous …"
  docker image inspect manga-studio-api:previous >/dev/null 2>&1 && docker tag manga-studio-api:previous manga-studio-api:latest || true
  docker image inspect manga-studio:previous   >/dev/null 2>&1 && docker tag manga-studio:previous   manga-studio:latest   || true
  $COMPOSE up -d --no-build 2>&1 | tail -2 || true
  die "已回滚（若可）。排查：$COMPOSE logs --tail=50 api"
}
trap rollback ERR

say "构建镜像（DOCKER_BUILDKIT=${DOCKER_BUILDKIT:-0}）…"
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}" $COMPOSE build api frontend

say "启动/更新容器…"
$COMPOSE up -d
trap - ERR

# ---------- 3. 等待 API 健康 ----------
say "等待 API 健康（最长 300s）…"
for i in $(seq 1 60); do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$API_CONTAINER" 2>/dev/null || echo missing)
  [ "$st" = healthy ] && break
  [ "$i" = 60 ] && die "API 300s 未健康（当前: $st）。日志：docker logs --tail=80 $API_CONTAINER"
  sleep 5
done
ok "API healthy"

# ---------- 4. 冒烟 ----------
say "冒烟验证…"
curl -fsS "http://localhost:${PUBLIC_PORT}/api/health" >/dev/null || die "GET /api/health 失败"
curl -fsS -o /dev/null "http://localhost:${PUBLIC_PORT}/" || die "前端首页返回失败"
ok "冒烟通过：/api/health 200，前端 200"

# ---------- 5. 汇总 ----------
say "部署完成 ✔"
docker ps --filter name=manga-studio --format '  {{.Names}}  {{.Status}}'
echo "  入口: ${PUBLIC_APP_URL:-http://localhost:${PUBLIC_PORT}}"
echo "  建议: ./scripts/health-check.sh 复检；./scripts/backup-now.sh 做一次部署后备份"

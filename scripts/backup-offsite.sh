#!/usr/bin/env bash
# 离线备份上传：把 backups/*.dump.age 上传到 S3 兼容存储（AWS S3 / MinIO / Cloudflare R2 / Aliyun OSS）。
#
# 用法：
#   ./scripts/backup-offsite.sh           # 正常上传
#   ./scripts/backup-offsite.sh --dry-run # 仅列出将要上传的文件
#   ./scripts/backup-offsite.sh --retention-days 60  # 覆盖保留天数
#
# 环境变量（均可选，带默认值）：
#   BACKUP_OFFSITE_ENABLED=true|false       # 是否启用（默认 true）
#   BACKUP_OFFSITE_PROVIDER=s3              # 提供商标识（默认 s3）
#   BACKUP_OFFSITE_ENDPOINT=https://s3.example.com  # S3 端点
#   BACKUP_OFFSITE_BUCKET=manga-studio-backups      # 存储桶名
#   BACKUP_OFFSITE_ACCESS_KEY=xxx           # Access Key
#   BACKUP_OFFSITE_SECRET_KEY=xxx           # Secret Key
#   BACKUP_OFFSITE_REGION=us-east-1         # 区域（默认 us-east-1）
#   BACKUP_OFFSITE_RETENTION_DAYS=90        # 远端保留天数（默认 90）
#   BACKUP_OFFSITE_STORAGE_CLASS=STANDARD   # 存储类（默认 STANDARD）
#
# 退出码：
#   0 = 成功
#   1 = 配置错误
#   2 = 上传失败
#   3 = 校验失败
#
# 依赖：优先用 rclone，回退 aws cli / s3cmd。需提前配置好对应工具。
set -euo pipefail

# --- 颜色与日志 ---
say()  { printf '\033[1;36m[offsite]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; }

# --- 默认值 ---
BACKUP_OFFSITE_ENABLED="${BACKUP_OFFSITE_ENABLED:-true}"
BACKUP_OFFSITE_PROVIDER="${BACKUP_OFFSITE_PROVIDER:-s3}"
BACKUP_OFFSITE_ENDPOINT="${BACKUP_OFFSITE_ENDPOINT:-}"
BACKUP_OFFSITE_BUCKET="${BACKUP_OFFSITE_BUCKET:-}"
BACKUP_OFFSITE_ACCESS_KEY="${BACKUP_OFFSITE_ACCESS_KEY:-}"
BACKUP_OFFSITE_SECRET_KEY="${BACKUP_OFFSITE_SECRET_KEY:-}"
BACKUP_OFFSITE_REGION="${BACKUP_OFFSITE_REGION:-us-east-1}"
BACKUP_OFFSITE_RETENTION_DAYS="${BACKUP_OFFSITE_RETENTION_DAYS:-90}"
BACKUP_OFFSITE_STORAGE_CLASS="${BACKUP_OFFSITE_STORAGE_CLASS:-STANDARD}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DRY_RUN=false
MAX_RETRIES=3

# --- 解析参数 ---
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --retention-days)
      shift
      BACKUP_OFFSITE_RETENTION_DAYS="${1:-}"
      ;;
    --help|-h)
      grep '^#' "$0" | head -30 | sed 's/^# \?//'
      exit 0
      ;;
    *) err "未知参数: $1"; exit 1 ;;
  esac
  shift
done

# --- 检查是否启用 ---
if [ "$BACKUP_OFFSITE_ENABLED" != "true" ]; then
  say "BACKUP_OFFSITE_ENABLED!=true，跳过离线备份"
  exit 0
fi

# --- 配置校验 ---
need() { [ -n "${!1:-}" ] || { err "缺少必填环境变量: $1"; exit 1; }; }
need BACKUP_OFFSITE_ENDPOINT
need BACKUP_OFFSITE_BUCKET
need BACKUP_OFFSITE_ACCESS_KEY
need BACKUP_OFFSITE_SECRET_KEY

[ -d "$BACKUP_DIR" ] || { err "备份目录不存在: $BACKUP_DIR"; exit 1; }

# --- 检测可用工具 ---
TOOL=""
if command -v rclone >/dev/null 2>&1; then
  TOOL="rclone"
elif command -v aws >/dev/null 2>&1; then
  TOOL="aws"
elif command -v s3cmd >/dev/null 2>&1; then
  TOOL="s3cmd"
else
  err "未找到 rclone / aws cli / s3cmd，请先安装其中之一"
  exit 1
fi
say "使用工具: $TOOL"

# --- 导出 AWS 凭证供 aws cli / s3cmd 使用 ---
export AWS_ACCESS_KEY_ID="$BACKUP_OFFSITE_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$BACKUP_OFFSITE_SECRET_KEY"
export AWS_DEFAULT_REGION="$BACKUP_OFFSITE_REGION"

# --- 计算 --max-age 参数（仅上传 retention 内的文件）---
# rclone --max-age 接受如 90d，aws cli 无直接对应，靠 find 过滤
MAX_AGE_ARG=""
if [ "$TOOL" = "rclone" ]; then
  MAX_AGE_ARG="--max-age ${BACKUP_OFFSITE_RETENTION_DAYS}d"
fi

# --- 找出待上传文件（仅 *.dump.age，且 mtime 在保留窗口内）---
# 使用 find 统一过滤，兼容三种工具
shopt -s nullglob
if [ "$TOOL" = "rclone" ]; then
  # rclone 自己会按 --max-age 过滤，这里只列 *.dump.age
  files=("$BACKUP_DIR"/*.dump.age)
else
  # aws / s3cmd 需要自己按 mtime 过滤
  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.age' -type f -mtime -"$BACKUP_OFFSITE_RETENTION_DAYS" 2>/dev/null | sort)
fi

if [ ${#files[@]} -eq 0 ]; then
  say "没有符合条件的 *.dump.age 文件（或均超出保留窗口），无需上传"
  exit 0
fi

say "发现 ${#files[@]} 个待上传文件"

# --- 打印将要上传的文件（dry-run 或正常模式均打印）---
for f in "${files[@]}"; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "?")
  printf '  %s (%s bytes)\n' "$(basename "$f")" "$size"
done

if [ "$DRY_RUN" = true ]; then
  ok "Dry-run 完成，未实际上传"
  exit 0
fi

# --- 重试函数（指数退避）---
retry() {
  local cmd="$1"
  local attempt=1
  local delay=2
  while [ $attempt -le $MAX_RETRIES ]; do
    if eval "$cmd"; then
      return 0
    fi
    warn "第 $attempt 次尝试失败，${delay}s 后重试…"
    sleep $delay
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
  return 1
}

# --- 上传单文件 ---
upload_file() {
  local src="$1"
  local dst_name
  dst_name="$(basename "$src")"
  local dst_path

  case "$TOOL" in
    rclone)
      # rclone 配置临时 remote
      local remote_name="offsite_${BACKUP_OFFSITE_PROVIDER}_$$"
      rclone config create "$remote_name" s3 \
        provider "$BACKUP_OFFSITE_PROVIDER" \
        endpoint "$BACKUP_OFFSITE_ENDPOINT" \
        access_key_id "$BACKUP_OFFSITE_ACCESS_KEY" \
        secret_access_key "$BACKUP_OFFSITE_SECRET_KEY" \
        region "$BACKUP_OFFSITE_REGION" \
        acl private >/dev/null 2>&1
      # 上传
      retry "rclone copy --progress --storage-class $BACKUP_OFFSITE_STORAGE_CLASS $MAX_AGE_ARG \"$src\" \"$remote_name:$BACKUP_OFFSITE_BUCKET/\""
      # 清理临时 remote
      rclone config delete "$remote_name" >/dev/null 2>&1 || true
      ;;
    aws)
      dst_path="s3://$BACKUP_OFFSITE_BUCKET/$dst_name"
      retry "aws s3 cp --storage-class $BACKUP_OFFSITE_STORAGE_CLASS \"$src\" \"$dst_path\""
      ;;
    s3cmd)
      dst_path="s3://$BACKUP_OFFSITE_BUCKET/$dst_name"
      retry "s3cmd put --storage-class=$BACKUP_OFFSITE_STORAGE_CLASS \"$src\" \"$dst_path\""
      ;;
  esac
}

# --- 校验单文件（SHA256）---
verify_file() {
  local src="$1"
  local dst_name
  dst_name="$(basename "$src")"
  local local_hash remote_hash

  local_hash=$(sha256sum "$src" | awk '{print $1}')

  case "$TOOL" in
    rclone)
      local remote_name="offsite_${BACKUP_OFFSITE_PROVIDER}_$$"
      rclone config create "$remote_name" s3 \
        provider "$BACKUP_OFFSITE_PROVIDER" \
        endpoint "$BACKUP_OFFSITE_ENDPOINT" \
        access_key_id "$BACKUP_OFFSITE_ACCESS_KEY" \
        secret_access_key "$BACKUP_OFFSITE_SECRET_KEY" \
        region "$BACKUP_OFFSITE_REGION" \
        acl private >/dev/null 2>&1
      remote_hash=$(rclone hashsum sha256 "$remote_name:$BACKUP_OFFSITE_BUCKET/$dst_name" 2>/dev/null | awk '{print $1}')
      rclone config delete "$remote_name" >/dev/null 2>&1 || true
      ;;
    aws)
      remote_hash=$(aws s3api head-object --bucket "$BACKUP_OFFSITE_BUCKET" --key "$dst_name" --query 'Metadata.sha256' --output text 2>/dev/null || true)
      if [ -z "$remote_hash" ] || [ "$remote_hash" = "None" ]; then
        # 回退：下载并计算（大文件慎用，这里仅作兜底）
        remote_hash=$(aws s3 cp "s3://$BACKUP_OFFSITE_BUCKET/$dst_name" - 2>/dev/null | sha256sum | awk '{print $1}')
      fi
      ;;
    s3cmd)
      remote_hash=$(s3cmd info "s3://$BACKUP_OFFSITE_BUCKET/$dst_name" 2>/dev/null | grep -i sha256 | awk '{print $2}' || true)
      if [ -z "$remote_hash" ]; then
        remote_hash=$(s3cmd get "s3://$BACKUP_OFFSITE_BUCKET/$dst_name" - 2>/dev/null | sha256sum | awk '{print $1}')
      fi
      ;;
  esac

  if [ -z "$remote_hash" ]; then
    err "无法获取远端 SHA256: $dst_name"
    return 1
  fi

  if [ "$local_hash" = "$remote_hash" ]; then
    ok "校验通过: $dst_name"
    return 0
  else
    err "校验失败: $dst_name (local=$local_hash remote=$remote_hash)"
    return 1
  fi
}

# --- 执行上传 ---
upload_failed=0
verify_failed=0

for f in "${files[@]}"; do
  say "上传: $(basename "$f")"
  if ! upload_file "$f"; then
    err "上传失败: $(basename "$f")"
    upload_failed=1
    continue
  fi
  ok "上传完成: $(basename "$f")"

  say "校验: $(basename "$f")"
  if ! verify_file "$f"; then
    verify_failed=1
  fi
done

# --- 清理远端过期文件（可选，rclone 支持 --min-age 删除）---
if [ "$TOOL" = "rclone" ] && [ $upload_failed -eq 0 ]; then
  say "清理远端超过 ${BACKUP_OFFSITE_RETENTION_DAYS} 天的对象…"
  remote_name="offsite_${BACKUP_OFFSITE_PROVIDER}_$$"
  rclone config create "$remote_name" s3 \
    provider "$BACKUP_OFFSITE_PROVIDER" \
    endpoint "$BACKUP_OFFSITE_ENDPOINT" \
    access_key_id "$BACKUP_OFFSITE_ACCESS_KEY" \
    secret_access_key "$BACKUP_OFFSITE_SECRET_KEY" \
    region "$BACKUP_OFFSITE_REGION" \
    acl private >/dev/null 2>&1
  rclone delete --min-age "${BACKUP_OFFSITE_RETENTION_DAYS}d" "$remote_name:$BACKUP_OFFSITE_BUCKET/" --progress 2>/dev/null || warn "远端清理失败（忽略）"
  rclone config delete "$remote_name" >/dev/null 2>&1 || true
fi

# --- 结果汇总 ---
if [ $upload_failed -ne 0 ]; then
  err "部分文件上传失败"
  exit 2
fi
if [ $verify_failed -ne 0 ]; then
  err "部分文件校验失败"
  exit 3
fi

ok "离线备份完成：${#files[@]} 个文件已上传并校验通过"
exit 0
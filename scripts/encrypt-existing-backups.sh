#!/usr/bin/env bash
# 一次性迁移：把 backups/ 里历史的明文 pg_dump 快照用 age 加密（R1 整改）。
#
# 用法：
#   1) 安装 age 并生成密钥对（仅首次）：brew install age && age-keygen -o age.key
#   2) 导出公钥：  export BACKUP_AGE_RECIPIENT=$(grep 'public key' age.key | awk '{print $3}')
#   3) 演练（只加密，不删明文）：
#        bash scripts/encrypt-existing-backups.sh
#   4) 确认 .dump.age 可解密（age -d -i age.key -o /dev/null xxx.dump.age）后，再执行删除明文：
#        bash scripts/encrypt-existing-backups.sh --remove-plaintext
#
# 加密成功后的文件与自动备份产物同名规则一致（xxx.dump.age），可被 BACKUP_KEEP 轮转统一管理。
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
REMOVE_PLAINTEXT=false
[ "${1:-}" = "--remove-plaintext" ] && REMOVE_PLAINTEXT=true

if [ -z "$RECIPIENT" ]; then
  echo "错误：未设置 BACKUP_AGE_RECIPIENT（age 公钥）。先 age-keygen 生成并 export。" >&2
  exit 1
fi

shopt -s nullglob
dumps=("$BACKUP_DIR"/*.dump)
if [ ${#dumps[@]} -eq 0 ]; then
  echo "没有发现明文 .dump，无需迁移。"
  exit 0
fi

for f in "${dumps[@]}"; do
  out="${f}.age"
  if [ -f "$out" ]; then
    echo "跳过（已存在加密版）：$f"
    continue
  fi
  echo "加密：$f"
  age -r "$RECIPIENT" -o "$out" "$f"
  if [ "$REMOVE_PLAINTEXT" = true ]; then
    # 再次确认加密文件确实存在且非空，才删除明文
    if [ -s "$out" ]; then
      rm "$f"
      echo "  已删除明文：$f"
    else
      echo "  警告：加密文件为空，保留明文：$f" >&2
    fi
  fi
done

echo "完成。未删除明文前，请先逐一验证 .dump.age 可解密。"

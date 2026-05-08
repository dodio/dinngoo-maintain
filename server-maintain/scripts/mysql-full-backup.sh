#!/usr/bin/env bash
# 全量 MySQL 备份 + gzip；清理旧文件。在 php-server 宿主机上执行，需能连上 MySQL。
# 用法: 先 export 或 source .env，再:
#   bash scripts/mysql-full-backup.sh
set -euo pipefail

: "${MYSQL_HOST:?}"
: "${MYSQL_USER:?}"
: "${MYSQL_DATABASE:?}"
: "${BACKUP_DIR:?}"

MYSQL_PORT="${MYSQL_PORT:-3306}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

if [[ -z "${MYSQL_PASSWORD:-}" ]]; then
  echo "请设置 MYSQL_PASSWORD（勿写入仓库）" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/${MYSQL_DATABASE}_${STAMP}.sql.gz"

export MYSQL_PWD="$MYSQL_PASSWORD"
mysqldump \
  -h "$MYSQL_HOST" \
  -P "$MYSQL_PORT" \
  -u "$MYSQL_USER" \
  --single-transaction \
  --quick \
  --routines \
  --events \
  "$MYSQL_DATABASE" \
  | gzip -c > "$OUT"
unset MYSQL_PWD

echo "备份: $OUT ($(du -h "$OUT" | cut -f1))"

if [[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] && [[ "$BACKUP_KEEP_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "*.sql.gz" -mtime "+$BACKUP_KEEP_DAYS" -print -delete || true
fi

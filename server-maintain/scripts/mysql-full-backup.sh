#!/usr/bin/env bash
# 全量 MySQL 备份 + gzip；清理旧文件。
# 方式 A：宿主机有 mysqldump，连 MYSQL_HOST（通常为 127.0.0.1）
# 方式 B：宿主机无客户端时设 MYSQLDUMP_COMPOSE_FILE=php-server 的 compose 文件路径，
#         经 docker compose exec 在 mysql 容器内执行 mysqldump。
# 用法: source .env（含 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE）后再执行本脚本。
set -euo pipefail

: "${MYSQL_USER:?}"
: "${MYSQL_DATABASE:?}"
: "${BACKUP_DIR:?}"

MYSQL_PORT="${MYSQL_PORT:-3306}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MYSQLDUMP_COMPOSE_SERVICE="${MYSQLDUMP_COMPOSE_SERVICE:-mysql}"

if [[ -z "${MYSQL_PASSWORD:-}" ]]; then
  echo "请设置 MYSQL_PASSWORD（勿写入仓库）" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/${MYSQL_DATABASE}_${STAMP}.sql.gz"

dump_via_tcp() {
  : "${MYSQL_HOST:?}"
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysqldump \
    -h "$MYSQL_HOST" \
    -P "$MYSQL_PORT" \
    -u "$MYSQL_USER" \
    --single-transaction \
    --quick \
    --no-tablespaces \
    --routines \
    --events \
    "$MYSQL_DATABASE"
  unset MYSQL_PWD
}

dump_via_docker() {
  : "${MYSQLDUMP_COMPOSE_FILE:?}"
  docker compose -f "$MYSQLDUMP_COMPOSE_FILE" exec -T \
    -e MYSQL_PWD="$MYSQL_PASSWORD" \
    "$MYSQLDUMP_COMPOSE_SERVICE" \
    mysqldump \
    -h 127.0.0.1 \
    -P 3306 \
    -u "$MYSQL_USER" \
    --single-transaction \
    --quick \
    --no-tablespaces \
    --routines \
    --events \
    "$MYSQL_DATABASE"
}

if [[ -n "${MYSQLDUMP_COMPOSE_FILE:-}" ]]; then
  dump_via_docker | gzip -c > "$OUT"
elif command -v mysqldump >/dev/null 2>&1; then
  : "${MYSQL_HOST:?}"
  dump_via_tcp | gzip -c > "$OUT"
else
  echo "未找到 mysqldump，请安装 mysql-client，或设置 MYSQLDUMP_COMPOSE_FILE 使用容器内导出" >&2
  exit 1
fi

echo "备份: $OUT ($(du -h "$OUT" | cut -f1))"

if [[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] && [[ "$BACKUP_KEEP_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "*.sql.gz" -mtime "+$BACKUP_KEEP_DAYS" -print -delete || true
fi

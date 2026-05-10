#!/usr/bin/env bash
# 供 /etc/cron.d 每日调用：在 server-maintain 目录加载 .env 后执行全量 mysqldump。
# 日志：/var/log/maint-mysql-backup.log（由 install-dinngoo-maintain-cron.sh 创建并 chown）
set -euo pipefail
SM="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SM"
{
	echo "=== $(date -Is 2>/dev/null || date) cron-mysql-backup-daily ==="
	set -a
	if [[ -f .env ]]; then
		# shellcheck source=/dev/null
		. ./.env
	else
		echo "缺少 ${SM}/.env，跳过备份" >&2
		exit 1
	fi
	set +a
	bash scripts/mysql-full-backup.sh
} >>/var/log/maint-mysql-backup.log 2>&1

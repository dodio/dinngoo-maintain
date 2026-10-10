#!/usr/bin/env bash
# 在宿主上依次启动独立 MySQL（dinngoo-db）、dinngoo-site（C 端）、dinngoo-admin（新后台）。
# 约定路径：/srv/dinngoo-room/...；需已配置各自的 .env / .env.production.local / standalone-runtime。
#
# 2026-10-10 起 PHP（php-server 栈）已下线，本脚本不再启动 php / nginx。
#
#   cd /srv/dinngoo-room/dinngoo-maintain
#   bash deploy/start-dinngoo-docker-stacks.sh
#
set -euo pipefail

DINNGOO_SRV_ROOT="${DINNGOO_SRV_ROOT:-/srv/dinngoo-room}"
DB_SRV="${DINNGOO_SRV_ROOT}/mysql"
SITE_SRV="${DINNGOO_SRV_ROOT}/dinngoo-site"
ADMIN_SRV="${DINNGOO_SRV_ROOT}/dinngoo-admin"

die() { echo "错误: $*" >&2; exit 1; }

command -v docker >/dev/null || die "未找到 docker"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose"

[[ -f "${DB_SRV}/docker-compose.prod.yml" ]] || die "未找到 ${DB_SRV}/docker-compose.prod.yml"
[[ -f "${DB_SRV}/.env" ]] || die "请先在 ${DB_SRV} 配置 .env（参见 supports/deploy/mysql/env.example）"
[[ -d "${SITE_SRV}" ]] || die "未找到 ${SITE_SRV}"
[[ -d "${ADMIN_SRV}" ]] || die "未找到 ${ADMIN_SRV}"
[[ -f "${SITE_SRV}/docker-compose.prod.yml" ]] || die "未找到 ${SITE_SRV}/docker-compose.prod.yml"
[[ -f "${ADMIN_SRV}/docker-compose.prod.yml" ]] || die "未找到 ${ADMIN_SRV}/docker-compose.prod.yml"

echo "==> docker network dinngoo_net"
docker network create dinngoo_net 2>/dev/null || true

echo "==> dinngoo-db: mysql（数据卷为外部卷 dinngoo-db_mysql_data，不存在会直接报错）"
cd "${DB_SRV}"
docker compose -f docker-compose.prod.yml up -d

start_next() {
	local name="$1" dir="$2"
	local standalone="${dir}/.next/standalone-runtime/server.js"
	if [[ ! -f "${standalone}" ]]; then
		if command -v npm >/dev/null && [[ -f "${dir}/deploy/stage-standalone.sh" ]]; then
			echo "==> ${name}: 未检测到 standalone，正在执行 stage-standalone.sh"
			(cd "${dir}" && bash deploy/stage-standalone.sh)
		else
			die "未找到 ${standalone} 且无 npm，请在 ${dir} 手动执行 deploy/stage-standalone.sh"
		fi
	fi
	echo "==> ${name}: next"
	(cd "${dir}" && docker compose -f docker-compose.prod.yml up -d --build)
}

start_next "dinngoo-site" "${SITE_SRV}"
start_next "dinngoo-admin" "${ADMIN_SRV}"

echo "==> 完成。查看: docker compose -f docker-compose.prod.yml ps（分别在 mysql / dinngoo-site / dinngoo-admin 目录）"

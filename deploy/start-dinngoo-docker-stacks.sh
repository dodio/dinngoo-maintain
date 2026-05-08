#!/usr/bin/env bash
# 在宿主上依次启动 php-server（mysql + php + nginx）与 dinngoo-site（next）。
# 约定路径：/srv/dinngoo-room/...；需已配置 .env / standalone-runtime。
#
#   cd /srv/dinngoo-room/dinngoo-maintain
#   bash deploy/start-dinngoo-docker-stacks.sh
#
set -euo pipefail

DINNGOO_SRV_ROOT="${DINNGOO_SRV_ROOT:-/srv/dinngoo-room}"
PHP_SRV="${DINNGOO_SRV_ROOT}/php-server"
NEXT_SRV="${DINNGOO_SRV_ROOT}/dinngoo-site"

die() { echo "错误: $*" >&2; exit 1; }

command -v docker >/dev/null || die "未找到 docker"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose"

[[ -d "${PHP_SRV}" ]] || die "未找到 ${PHP_SRV}"
[[ -d "${NEXT_SRV}" ]] || die "未找到 ${NEXT_SRV}"
[[ -f "${PHP_SRV}/docker-compose.prod.yml" ]] || die "未找到 ${PHP_SRV}/docker-compose.prod.yml"
[[ -f "${NEXT_SRV}/docker-compose.prod.yml" ]] || die "未找到 ${NEXT_SRV}/docker-compose.prod.yml"
[[ -f "${PHP_SRV}/.env" ]] || die "请先在 ${PHP_SRV} 配置 .env（参见 deploy/env.compose.prod.example）"

echo "==> docker network dinngoo_net"
docker network create dinngoo_net 2>/dev/null || true

echo "==> php-server: mysql"
cd "${PHP_SRV}"
docker compose -f docker-compose.prod.yml up -d mysql

echo "==> php-server: php + nginx（构建可能较久）"
docker compose -f docker-compose.prod.yml up -d --build php nginx

STANDALONE="${NEXT_SRV}/.next/standalone-runtime/server.js"
if [[ ! -f "${STANDALONE}" ]]; then
	if command -v npm >/dev/null && [[ -f "${NEXT_SRV}/deploy/stage-standalone.sh" ]]; then
		echo "==> dinngoo-site: 未检测到 standalone，正在执行 stage-standalone.sh"
		(cd "${NEXT_SRV}" && bash deploy/stage-standalone.sh)
	else
		die "未找到 ${STANDALONE} 且无 npm，请在 ${NEXT_SRV} 手动执行 ./deploy/stage-standalone.sh"
	fi
fi

echo "==> dinngoo-site: next"
cd "${NEXT_SRV}"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> 完成。查看: docker compose -f docker-compose.prod.yml ps（分别在 php-server / dinngoo-site 目录）"

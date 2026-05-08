#!/usr/bin/env bash
# 调用已安装的包装命令（内含 sudo 下正确的 node 路径）。未安装时见 deploy/SERVER-MAINTAIN-部署.md
set -euo pipefail
WR=/usr/local/sbin/dinngoo-rotate-gate-tokens
[[ -x "$WR" ]] || {
	echo "未找到 $WR。执行: cd /srv/dinngoo-room/dinngoo-maintain && sudo bash deploy/install-dinngoo-server-maintain-wrappers.sh" >&2
	exit 1
}
exec sudo "$WR" "$@"

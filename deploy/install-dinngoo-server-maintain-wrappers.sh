#!/usr/bin/env bash
# 零参数。目录约定：本仓库须在 /srv/dinngoo-room/dinngoo-maintain（见 deploy/SERVER-MAINTAIN-部署.md）。
# 须 sudo，且由「要免密的普通用户」发起，以便 SUDO_USER 正确。
#
#   cd /srv/dinngoo-room/dinngoo-maintain
#   sudo bash deploy/install-dinngoo-server-maintain-wrappers.sh
#
set -euo pipefail

DINNGOO_SRV_ROOT="/srv/dinngoo-room"
CONVENTION_MAINTAIN="$DINNGOO_SRV_ROOT/dinngoo-maintain"

die() { echo "错误: $*" >&2; exit 1; }

[[ "${EUID:-0}" -eq 0 ]] || die "请执行: sudo bash $0（由运维用户运行 sudo，不要事先切到 root -i）"

SELF="$(readlink -f "$0")"
DEPLOY_DIR="$(dirname "$SELF")"
REPO_ROOT="$(dirname "$DEPLOY_DIR")"
SM="$REPO_ROOT/server-maintain"

[[ "$REPO_ROOT" == "$CONVENTION_MAINTAIN" ]] || die "目录约定: dinngoo-maintain 须在 $CONVENTION_MAINTAIN（当前: $REPO_ROOT）。见 deploy/SERVER-MAINTAIN-部署.md"

[[ -d "$SM" ]] || die "未找到 server-maintain: $SM"

MJS="$SM/scripts/rotate-gate-tokens.mjs"
FETCH="$SM/scripts/fetch-caddy-gate-tokens.sh"
[[ -f "$MJS" && -f "$FETCH" ]] || die "未找到脚本: $MJS 或 $FETCH"

RUNAS_USER="${SUDO_USER:-}"
if [[ -z "$RUNAS_USER" || "$RUNAS_USER" == root ]]; then
	RUNAS_USER="$(stat -c '%U' "$REPO_ROOT" 2>/dev/null || true)"
fi
if [[ -z "$RUNAS_USER" || "$RUNAS_USER" == root ]]; then
	die "无法确定运维用户。请用普通账号执行「sudo bash $SELF」，不要「sudo su」后无 SUDO_USER"
fi
id "$RUNAS_USER" &>/dev/null || die "系统无此用户: $RUNAS_USER"

pick_nvm_node() {
	local u="$1"
	shopt -s nullglob
	local -a cands=( /home/"$u"/.nvm/versions/node/*/bin/node )
	shopt -u nullglob
	[[ ${#cands[@]} -eq 0 ]] && return 1
	local one
	one=$(printf '%s\n' "${cands[@]}" | sort -V | tail -n1)
	[[ -n "$one" && -x "$one" ]] && echo "$one"
}

NODE_CMD=""
if tmp="$(sudo -u "$RUNAS_USER" -H bash -lc 'command -v node' 2>/dev/null)" && [[ -x "$tmp" ]]; then
	NODE_CMD="$tmp"
elif tmp="$(pick_nvm_node "$RUNAS_USER")"; then
	NODE_CMD="$tmp"
elif [[ -x /usr/bin/node ]]; then
	NODE_CMD=/usr/bin/node
elif [[ -x /usr/local/bin/node ]]; then
	NODE_CMD=/usr/local/bin/node
fi

[[ -n "$NODE_CMD" && -x "$NODE_CMD" ]] || die "未找到可执行的 node（已为 $RUNAS_USER 尝试 login shell、~/.nvm、/usr/bin/node）。请在该用户下安装 Node ≥18。"

ROT_WR=/usr/local/sbin/dinngoo-rotate-gate-tokens
FET_WR=/usr/local/sbin/dinngoo-fetch-caddy-gate-tokens
SUDO_F=/etc/sudoers.d/dinngoo-server-maintain

printf '%s\n' '#!/bin/sh' "exec $(printf '%q' "$NODE_CMD") $(printf '%q' "$MJS") \"\$@\"" >"$ROT_WR"
chmod 755 "$ROT_WR"

printf '%s\n' '#!/bin/sh' "exec /bin/bash $(printf '%q' "$FETCH") \"\$@\"" >"$FET_WR"
chmod 755 "$FET_WR"

{
	echo "# 由 install-dinngoo-server-maintain-wrappers.sh 生成；升级 nvm 后可再次「sudo bash deploy/install-dinngoo-server-maintain-wrappers.sh」"
	echo "$RUNAS_USER ALL=(root) NOPASSWD: $ROT_WR"
	echo "$RUNAS_USER ALL=(root) NOPASSWD: $FET_WR"
} >"$SUDO_F"
chmod 440 "$SUDO_F"

visudo -cf "$SUDO_F" || {
	rm -f "$SUDO_F"
	die "sudoers 语法失败，已删除 $SUDO_F（包装命令仍在 /usr/local/sbin）"
}

echo "完成。运维用户: $RUNAS_USER  node: $NODE_CMD"
echo "  $ROT_WR"
echo "  $FET_WR"
echo "  $SUDO_F"
echo "免密: dinngoo-rotate-gate-tokens、dinngoo-fetch-caddy-gate-tokens"

#!/usr/bin/env bash
# 通过 SSH 登录远端，从 systemd 加载的 Caddy EnvironmentFile 中列出 MAINT_* / OP_* 门禁变量。
# 远端需能非交互执行 sudo grep（例如 NOPASSWD，或先用 ssh -t 交互 sudo 一次）。
#
# 用法:
#   ./fetch-caddy-gate-tokens.sh dinngoo-test
#   ./fetch-caddy-gate-tokens.sh user@38.190.206.66
#   TARGET=dinngoo-test ./fetch-caddy-gate-tokens.sh
#
# 可选环境变量:
#   SSH_TARGET / TARGET — 未写第一个参数时用
#   SSH_EXTRA_OPTS — 传给 ssh 的额外参数（如 -i ~/.ssh/key）
#   CADDY_SERVICE — systemd 单元名，默认 caddy

set -euo pipefail

usage() {
	echo "用法: $0 <SSH 目标>" >&2
	echo "  SSH 目标: user@host 或 ~/.ssh/config 里的 Host 别名（例: dinngoo-test）" >&2
	echo "  也可: TARGET=别名 $0   或   SSH_TARGET=别名 $0" >&2
	exit 1
}

target="${1:-${TARGET:-${SSH_TARGET:-}}}"
[[ -n "$target" ]] || usage

service="${CADDY_SERVICE:-caddy}"

ssh ${SSH_EXTRA_OPTS:-} "$target" bash -s -- "$service" <<'REMOTE'
set -u
service="$1"

echo "### systemctl show ${service} -p EnvironmentFiles --value"
systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true
echo ""

caddy_env_paths_from_cat() {
	systemctl cat "$service" 2>/dev/null | grep -E '^EnvironmentFile=' | while IFS= read -r line; do
		path="${line#EnvironmentFile=}"
		path="${path%%[[:space:]]*}"
		# EnvironmentFile=-/path：可选文件，去掉首部的一个 -
		if [[ "$path" == -* ]]; then
			path="${path#-}"
		fi
		[[ -n "$path" ]] && printf '%s\n' "$path"
	done
}

# 与 show 输出中显式出现的绝对路径合并（单行常见: /path (ignore_errors=no)）
paths_from_show() {
	local raw
	raw=$(systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true)
	[[ -z "$raw" ]] && return 0
	grep -oE '/[[:alnum:]/_./-]+' <<<"$raw" | sort -u
}

mapfile -t files < <(
	{
		caddy_env_paths_from_cat
		paths_from_show
	} | sort -u
)

if [[ ${#files[@]} -eq 0 || -z "${files[0]:-}" ]]; then
	echo "错误: 未解析到 ${service} 的 EnvironmentFile。请在服务器上检查:" >&2
	echo "  systemctl cat $service | grep -E '^EnvironmentFile='" >&2
	exit 1
fi

found_any=0
for f in "${files[@]}"; do
	[[ -z "$f" ]] && continue
	if sudo test -r "$f"; then
		echo "=== $f ==="
		if sudo grep -nE '^(MAINT_|OP_)' "$f" 2>/dev/null; then
			found_any=1
		fi
	else
		echo "跳过（不存在或无读权限）: $f" >&2
	fi
done

if [[ "$found_any" -eq 0 ]]; then
	echo "未在以上文件中匹配到 ^(MAINT_|OP_)。可能尚未配置 MAINT_GATE_TOKEN，或变量名不同。" >&2
	exit 2
fi
REMOTE

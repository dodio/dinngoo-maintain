#!/usr/bin/env bash
# 在**已部署 Caddy 的服务器上**执行：从 systemd 为 caddy 加载的 EnvironmentFile 中
# 打印所有 MAINT_* / OP_* 门禁相关变量（含 _OLD）。需在服务器上用 root 或 sudo：
#   sudo bash scripts/fetch-caddy-gate-tokens.sh
#
# 可选环境变量:
#   CADDY_SERVICE — systemd 单元名，默认 caddy

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
	echo "需要读 /etc/caddy 等路径，请执行: sudo $0" >&2
	exit 1
fi

service="${CADDY_SERVICE:-caddy}"

echo "### systemctl show ${service} -p EnvironmentFiles --value"
systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true
echo ""

caddy_env_paths_from_cat() {
	systemctl cat "$service" 2>/dev/null | grep -E '^EnvironmentFile=' | while IFS= read -r line; do
		path="${line#EnvironmentFile=}"
		path="${path%%[[:space:]]*}"
		if [[ "$path" == -* ]]; then
			path="${path#-}"
		fi
		[[ -n "$path" ]] && printf '%s\n' "$path"
	done
}

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
	echo "错误: 未解析到 ${service} 的 EnvironmentFile。请检查:" >&2
	echo "  systemctl cat $service | grep -E '^EnvironmentFile='" >&2
	exit 1
fi

found_any=0
for f in "${files[@]}"; do
	[[ -z "$f" ]] && continue
	echo "=== $f ==="
	if grep -nE '^(MAINT_|OP_)' "$f"; then
		found_any=1
	elif [[ $? -eq 2 ]]; then
		echo "错误: 无法读取或不存在: $f" >&2
		exit 1
	fi
done

if [[ "$found_any" -eq 0 ]]; then
	echo "未在以上文件中匹配到 ^(MAINT_|OP_)。可能尚未配置 MAINT_GATE_TOKEN，或变量名不同。" >&2
	exit 2
fi

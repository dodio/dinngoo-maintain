#!/usr/bin/env bash
# 列出 Caddy EnvironmentFile 中的 MAINT_* / OP_*。须以 root 运行（由 dinngoo-fetch-caddy-gate-tokens 调用）。
set -euo pipefail

[[ "${EUID:-0}" -eq 0 ]] || {
	echo "请使用: sudo dinngoo-fetch-caddy-gate-tokens（见 deploy/SERVER-MAINTAIN-部署.md）" >&2
	exit 1
}

service="${CADDY_SERVICE:-caddy}"

echo "### systemctl show ${service} -p EnvironmentFiles --value"
systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true
echo ""

caddy_env_paths_from_cat() {
	systemctl cat "$service" 2>/dev/null | grep -E '^EnvironmentFile=' | while IFS= read -r line; do
		path="${line#EnvironmentFile=}"
		path="${path%%[[:space:]]*}"
		[[ "$path" == -* ]] && path="${path#-}"
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
	echo "错误: 未解析到 ${service} 的 EnvironmentFile" >&2
	exit 1
fi

found_any=0
for f in "${files[@]}"; do
	[[ -z "$f" ]] && continue
	echo "=== $f ==="
	set +e
	out=$(grep -nE '^(MAINT_|OP_)' "$f" 2>&1)
	rc=$?
	set -e
	if [[ $rc -eq 0 ]]; then
		printf '%s\n' "$out"
		found_any=1
	elif [[ $rc -eq 1 ]]; then
		continue
	else
		printf '%s\n' "$out" >&2
		echo "无法读取: $f" >&2
		exit 1
	fi
done

if [[ "$found_any" -eq 0 ]]; then
	echo "未匹配到 MAINT_/OP_ 行" >&2
	exit 2
fi

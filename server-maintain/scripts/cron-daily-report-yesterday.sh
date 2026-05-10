#!/usr/bin/env bash
# 供 /etc/cron.d 在每日凌晨调用：统计「昨天」全天（本地自然日 00:00～23:59）的 Caddy JSON 与 SSH auth 采样。
# 依赖 generate-daily-report.mjs 默认逻辑（不传 --date）；cron 环境常无 TZ，此处默认 Asia/Shanghai。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

NODE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "${NODE}" || ! -x "${NODE}" ]]; then
	echo "cron-daily-report-yesterday: 未找到 node，请设置 NODE_BIN 或 PATH" >&2
	exit 1
fi

set -a
[[ -f "${ROOT}/.env" ]] && . "${ROOT}/.env"
set +a

export TZ="${TZ:-Asia/Shanghai}"

exec "${NODE}" "${ROOT}/scripts/generate-daily-report.mjs"

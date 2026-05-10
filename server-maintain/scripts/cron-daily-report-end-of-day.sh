#!/usr/bin/env bash
# 供 /etc/cron.d 在 59 23 * * * 调用：在 23:59:00 被拉起后 sleep 59，约于次日 00:00 前后结束。
# 报表日须在 sleep 之前取 date：sleep 后日历已进入「次日」，若再用 date +%F 会错选空数据的「新一天」。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

REPORT_YMD="$(date +%F)"

sleep 59

NODE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "${NODE}" || ! -x "${NODE}" ]]; then
	echo "cron-daily-report-end-of-day: 未找到 node，请设置 NODE_BIN 或 PATH" >&2
	exit 1
fi

set -a
[[ -f "${ROOT}/.env" ]] && . "${ROOT}/.env"
set +a

exec "${NODE}" "${ROOT}/scripts/generate-daily-report.mjs" --date "${REPORT_YMD}"

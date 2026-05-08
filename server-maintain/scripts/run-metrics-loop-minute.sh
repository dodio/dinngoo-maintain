#!/usr/bin/env bash
# 供 cron 每分钟调用一次：在本分钟内执行约 6 次 collect-metrics（间隔约 10 秒）。
# 依赖：在 server-maintain 目录配置好 .env，或依赖 MAILTO 之外由 cron 传入的环境。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

NODE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "run-metrics-loop-minute: 未找到 node，请设置 NODE_BIN 或 PATH" >&2
  exit 1
fi

set -a
[[ -f "$ROOT/.env" ]] && . "$ROOT/.env"
set +a

for n in 1 2 3 4 5 6; do
  "$NODE" "$ROOT/scripts/collect-metrics.mjs" || true
  [[ "$n" -lt 6 ]] && sleep 10
done

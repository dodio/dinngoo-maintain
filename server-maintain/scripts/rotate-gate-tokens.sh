#!/usr/bin/env bash
# 用当前用户 PATH 解析出的 node 绝对路径再 sudo，避免「sudo 找不到 node」（nvm 装在用户目录时常见）。
# 用法: bash scripts/rotate-gate-tokens.sh [--dry-run] [--write] ...
# 可选 NODE_BIN=/绝对路径/node
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "未找到 node，请先安装或设置 NODE_BIN=/path/to/node" >&2
  exit 1
fi
exec sudo -E "$NODE" "$ROOT/scripts/rotate-gate-tokens.mjs" "$@"

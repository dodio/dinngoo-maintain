#!/usr/bin/env bash
# 创建 Guance code-review Task。用法见同目录 ../SKILL.md
set -euo pipefail

GUANCE_BASE_URL="${GUANCE_BASE_URL:-http://localhost:3500}"
GUANCE_TOKEN="${GUANCE_TOKEN:-CQxXix6qCowhufczRhxJILk47Pxdd9MacetEYQmXJdfHIcJPPAsktsMjeKb3aWc0}"

TITLE=""
SCOPE="叮谷网"
BODY_FILE=""
REPO=""
BRANCH=""
BASE="main"

usage() {
  echo "Usage: $0 --title TITLE --body-file FILE [--scope SCOPE] [--repo REPO] [--branch BRANCH] [--base BASE]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$TITLE" && -n "$BODY_FILE" && -f "$BODY_FILE" ]] || usage

BRIEF_MD="$(cat "$BODY_FILE")"

if [[ -n "$REPO" && -n "$BRANCH" ]]; then
  BRIEF_MD="${BRIEF_MD}

## Git 上下文（自动生成）

- 仓库：\`${REPO}\`
- 分支：\`${BRANCH}\`
- 基线：\`${BASE}\`

\`\`\`bash
git diff ${BASE}...${BRANCH}
\`\`\`"
fi

export TITLE SCOPE BRIEF_MD GUANCE_BASE_URL GUANCE_TOKEN
RESP="$(python3 - <<'PY'
import json, os, urllib.request

payload = {
    "title": os.environ["TITLE"],
    "briefMd": os.environ["BRIEF_MD"],
    "scope": os.environ["SCOPE"],
    "tags": ["code-review"],
    "createdBy": "cursor-agent",
    "status": "OPEN",
}
req = urllib.request.Request(
    os.environ["GUANCE_BASE_URL"].rstrip("/") + "/api/task-journals",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={
        "Authorization": "Bearer " + os.environ["GUANCE_TOKEN"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    print(resp.read().decode("utf-8"))
PY
)"

echo "$RESP"
TASK_ID="$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || true)"
if [[ -n "$TASK_ID" ]]; then
  echo ""
  echo "Task URL: ${GUANCE_BASE_URL}/task-journal/${TASK_ID}"
fi

#!/usr/bin/env bash
# 提 PR 前推进版本号（默认按提交类型自动判定 patch / minor）。用法见同目录 ../SKILL.md
#
# 判定规则（--bump 留空时，依据 `git log --format=%s "$BASE"..HEAD"`）：
#   出现 feat / refactor 前缀   → minor（需求开发、重构）
#   其余（fix/style/chore/...） → patch（小修复、小改动）
# major 永不自动推进：必须用户明确要求后加 --confirm-major。
set -euo pipefail

REPO_DIR="$(pwd)"
BASE="main"
BUMP=""
NO_COMMIT=0
DRY_RUN=0
CONFIRM_MAJOR=0

usage() {
  cat <<'EOF'
Usage: bump-version.sh [--repo DIR] [--base BRANCH] [--bump patch|minor|major]
                       [--dry-run] [--no-commit] [--confirm-major]

  --repo DIR       仓库目录（默认当前目录；没有 package.json 则跳过）
  --base BRANCH    比较基线（默认 main；按当次目标分支传）
  --bump TYPE      patch | minor | major；留空=按提交类型自动判定（只会得到 patch/minor）
  --dry-run        只打印判定结果与目标版本，不写文件、不提交
  --no-commit      只改 package.json / package-lock.json，不自动提交
  --confirm-major  确认可以推进 major（必须由用户明确要求后传入）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_DIR="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --bump) BUMP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-commit) NO_COMMIT=1; shift ;;
    --confirm-major) CONFIRM_MAJOR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

cd "$REPO_DIR"

if [[ ! -f package.json ]]; then
  echo "[bump-version] 跳过：$REPO_DIR 下没有 package.json（如 php-server 不适用）"
  exit 0
fi

current="$(node -p "require('./package.json').version")"

if [[ -z "$BUMP" ]]; then
  if ! subjects="$(git log --format=%s "${BASE}..HEAD" 2>/dev/null)" || [[ -z "$subjects" ]]; then
    echo "[bump-version] 跳过：${BASE}..HEAD 没有可判定的提交"
    exit 0
  fi
  if grep -Eq '^(feat|refactor)(\([^)]*\))?!?:' <<<"$subjects"; then
    BUMP=minor
  else
    BUMP=patch
  fi
  echo "[bump-version] 按提交类型自动判定为 ${BUMP}："
  while IFS= read -r line; do echo "  - $line"; done <<<"$subjects"
fi

case "$BUMP" in
  patch|minor) ;;
  major)
    if [[ "$CONFIRM_MAJOR" != "1" ]]; then
      echo "[bump-version] major 版本需用户明确确认：先与用户确认，再加 --confirm-major" >&2
      exit 2
    fi
    ;;
  *) usage; exit 1 ;;
esac

next="$(node -e '
const [maj, min, pat] = require("./package.json").version.split(".").map(Number);
const bump = process.argv[1];
if (bump === "major") console.log(`${maj + 1}.0.0`);
else if (bump === "minor") console.log(`${maj}.${min + 1}.0`);
else console.log(`${maj}.${min}.${pat + 1}`);
' "$BUMP")"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[bump-version] dry-run：${current} → ${next}（${BUMP}），未写入"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[bump-version] 工作区不干净：请先提交本次改动，再推进版本号" >&2
  git status --short >&2
  exit 3
fi

npm version "$BUMP" --no-git-tag-version >/dev/null

if [[ "$NO_COMMIT" == "1" ]]; then
  echo "[bump-version] ${current} → ${next}（${BUMP}），已写入文件，未提交"
  exit 0
fi

git add package.json
if [[ -f package-lock.json ]]; then git add package-lock.json; fi
git commit -q -m "chore: 版本号 ${current} → ${next}（${BUMP}）"
echo "[bump-version] ${current} → ${next}（${BUMP}），已提交 $(git rev-parse --short HEAD)"

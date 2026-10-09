---
name: submit-pr-guance
description: >-
  通过观策（Guance）Task Journal 提交代码审阅 PR。Use when: 用户要求「提 PR」「提交 code review」、
  将变更登记到 Guance task、或需要为 Review Agent 创建审阅任务（scope 叮谷网等）。
---

# 提 PR → Guance Task（code-review）

将本地分支变更登记为观策 **事项档案（task-journal）**，供另一 Agent 用 `git diff` 审阅，并将结论写回 Task 记录流。

## 服务配置

| 项 | 值 |
|----|-----|
| Base URL | `http://localhost:3500`（本地 Guance；端口以实际 `PORT` 为准） |
| Skill 文档 | `http://localhost:3500/skills/guance-service.md`（若 404，读 `guance/public/skills/guance-service.md`） |
| Token | `CQxXix6qCowhufczRhxJILk47Pxdd9MacetEYQmXJdfHIcJPPAsktsMjeKb3aWc0` |
| 鉴权头 | `Authorization: Bearer <token>` |

探活：`GET /api/health`（无需 token）。

## 工作流

### 1. 确认代码已提交

在目标仓库（如 `dinngoo-site`、`php-server`）：

```bash
git status
git branch --show-current
git log -1 --oneline
```

未提交则先 `git add` + `git commit`（用户要求提交时）。

### 2. 撰写 PR 正文（写入 `briefMd`）

`briefMd` 使用 Markdown，建议包含：

- **Summary**：1–3 句说明
- **变更范围**：仓库、分支、基线（通常 `main`）、commit hash
- **主要改动**：文件/行为要点
- **代码审阅方式**：给 Review Agent 的 `git diff` 命令，例如：
  ```bash
  git diff main...feature/dinggu-2.0
  ```
- **Test plan**：勾选清单
- **审阅回写说明**：要求 Review Agent 用 `POST /api/task-journals/{id}/entries` 评论结论

### 3. 创建 Task

```bash
curl -sS -X POST "${GUANCE_BASE_URL}/api/task-journals" \
  -H "Authorization: Bearer ${GUANCE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<PR 标题，与 commit 主题一致>",
    "briefMd": "<上一步 Markdown，JSON 内转义换行>",
    "scope": "叮谷网",
    "tags": ["code-review"],
    "createdBy": "cursor-agent",
    "status": "OPEN"
  }'
```

字段说明（API 见 Guance `POST /api/task-journals`）：

| 字段 | 说明 |
|------|------|
| `title` | 任务标题 = PR 标题 |
| `briefMd` | 任务正文 = PR body（**不是** `body` 字段） |
| `scope` | 用户指定，如 `叮谷网` |
| `tags` | 审阅类固定含 `code-review` |

成功响应：`{ "ok": true, "data": { "id": "<uuid>", ... } }`

### 4. 回报给用户

提供：

- **Task ID**：`data.id`
- **页面链接**：`http://localhost:3500/task-journal/{id}`
- **Review Agent 指引**：在对应仓库跑 `git diff`，审阅后 POST entry：

```bash
curl -sS -X POST "http://localhost:3500/api/task-journals/{id}/entries" \
  -H "Authorization: Bearer ${GUANCE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entryType": "MEMO",
    "sourceType": "AI",
    "message": "<审阅结论 Markdown>"
  }'
```

### 5. 用户让你读审阅结果时

```bash
curl -sS "http://localhost:3500/api/task-journals/{id}/entries?page=1&pageSize=100" \
  -H "Authorization: Bearer ${GUANCE_TOKEN}"
```

读取最新 `sourceType: AI` 的 `MEMO` 记录，汇总并协助修代码。

## 快捷脚本

仓库内脚本（需本机可访问 Guance）：

```bash
supports/.cursor/skills/submit-pr-guance/scripts/create-review-task.sh \
  --title "feat: ..." \
  --scope "叮谷网" \
  --body-file /path/to/pr-body.md \
  --repo dinngoo-site \
  --branch feature/dinggu-2.0 \
  --base main
```

## 注意

- PR 正文临时文件写到 `$TMPDIR`（如 `mktemp`），**不要落在仓库里**；提交后删除。
- Guance **不是** GitHub PR；不自动 push。是否 `git push` 由用户另行决定。
- Token 写在 skill 内仅供本机开发；生产环境应改用环境变量。
- `scope`、`tags` 按用户当次指令填写；`code-review` 为审阅任务默认标签。

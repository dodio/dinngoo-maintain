# server-maintain — 叮谷整站运维小工具

与 [`supports/deploy`](../deploy/README.md) 配套：在**宿主机**上读取 Caddy JSON 日志、写静态日报、采集系统指标 JSON、全量备份 MySQL、手动轮换 Caddy 门禁 Token。

## 前置

- Node.js **≥ 18**
- 日报与指标脚本需在能读 **`/var/log/caddy/`**、写 **`REPORT_DIR`** 的用户下运行（常为 root 或 `adm` 组成员）。
- Caddy 站点 **`maint.dinngoo.xyz`**（测试环境运维仪表盘）的 `MAINT_STATIC_ROOT` 与本目录的 **`REPORT_DIR` 相同**；其它环境请与对应 `maint.*` 子域一致。首次把 [`public/dashboard.html`](./public/dashboard.html) 拷到该目录（与 `metrics.json` 同目录，便于相对路径拉取）。

```bash
cp public/dashboard.html "$REPORT_DIR/"
```

## 配置

复制 [`env.example`](./env.example) 为 `.env`（勿提交），或导出同名环境变量。也可用：

```bash
export SERVER_MAINTAIN_ENV=/path/to/.env
```

## 按「自然日」统计说明

Caddy 日志按**大小**滚动即可；日报脚本根据每行 JSON 的 **`ts`** 过滤到报表日（本地时区或 `TZ`），不要求一天一个日志文件。

## Docker 容器日志

生产 Compose 默认 **`logging.driver: json-file`**（`max-size` / `max-file`，便于本机 `docker logs` 与直接读 `*-json.log`）。

- **按日筛选 + 关键词粗扫**：[`scripts/analyze-docker-logs.mjs`](./scripts/analyze-docker-logs.mjs)（`npm run docker-logs`）  
  - 推荐配置 **`DOCKER_LOG_CONTAINERS`** 为 `docker ps --format '{{.Names}}'` 中的名字（逗号分隔）。  
  - 脚本用 `docker logs --since YYYY-MM-DDT00:00:00 --until 次日T00:00:00` 取当日行，再对每行做：尝试解析**内层 JSON**（应用打 JSON 时）否则当纯文本；按内置 + `DOCKER_LOG_KEYWORDS` 做**子串命中**统计，并可写入 **`$REPORT_DIR/docker-log-scan-YYYY-MM-DD.json`**。  
  - 若需直接扫磁盘上的 json-file，可设 **`DOCKER_JSON_LOG_GLOB`**（路径含一个 `*`）。

- **若改用 syslog**：需在宿主机自行配置 rsyslog 等接收 `/dev/log`（或 Docker 配置的 `syslog-address`），仓库不提供现成片段。

HTTP 访问量仍以 **Caddy JSON 访问日志**为主；本脚本侧重**容器 stdout/stderr 排障**。

## 脚本

| 脚本 | 说明 |
|------|------|
| `npm run report` | 生成 `daily-YYYY-MM-DD.html` 到 `REPORT_DIR`。默认统计「昨天」；`--date YYYY-MM-DD` 或 `REPORT_DATE` 覆盖。 |
| `npm run metrics` | 写入 `METRICS_JSON_PATH`（默认 `$REPORT_DIR/metrics.json`），供 `dashboard.html` 轮询。 |
| `bash scripts/mysql-full-backup.sh` | 全量 `mysqldump \| gzip` 到 `BACKUP_DIR`，并按 `BACKUP_KEEP_DAYS` 清理。 |
| `npm run docker-logs` | 按日筛选 Docker 日志并关键词统计；见上文「Docker 容器日志」。 |
| `sudo bash scripts/fetch-caddy-gate-tokens.sh` | 在**本机**（Caddy 所在宿主机）用 root 查看 `EnvironmentFile` 中的 **`MAINT_*` / `OP_*`** 行，便于核对书签用的 `entry_token`。 |
| `npm run rotate-tokens` | **手动**轮换 `MAINT_*` / `OP_*` token；**不要**配 cron。见下方。 |

### 排障：脚本报错时日志怎么看

这些脚本**不会**自动写专用运行日志；失败信息默认在 **标准错误（stderr）**。

| 运行方式 | 去哪看 |
|----------|--------|
| **手工前台** | 终端里直接就是输出；加 `set -x`（bash）或关注 Node 抛出的堆栈。 |
| **cron**（见下行示例） | 已用 `>>…log 2>&1` 时，看 **`/var/log/maint-report.log`**、**`/var/log/maint-mysql-backup.log`** 等；**指标**那一行若未重定向，只会邮件给 crontab 的 `MAILTO`，或丢失——建议同样追加到例如 **`/var/log/maint-metrics.log`**。 |
| **systemd oneshot/timer** | `journalctl -u 你的服务名 -e`，或在该 unit 里配置 `StandardOutput=append:/var/log/...`。 |

本机复现：`cd` 到 `server-maintain` 后加载 `.env`，再执行同一命令（不加 cron），一般能立刻看到报错原因（缺环境变量、无权限读 Caddy 日志、MySQL 连不上等）。

### Cron 示例（UTC+8 每日 0:20 跑昨日日报）

```cron
20 0 * * * cd /srv/dinggu-room/supports/server-maintain && set -a && [ -f .env ] && . ./.env && set +a && /usr/bin/node scripts/generate-daily-report.mjs >>/var/log/maint-report.log 2>&1
```

### 指标采集（每 10 秒，按负载可调）

```cron
* * * * * for i in 0 1 2 3 4; do sleep 10; cd /srv/dinggu-room/supports/server-maintain && set -a && [ -f .env ] && . ./.env && set +a && /usr/bin/node scripts/collect-metrics.mjs >>/var/log/maint-metrics.log 2>&1; done
```

### MySQL 备份（每日）

```cron
5 1 * * * cd /srv/dinggu-room/supports/server-maintain && set -a && . ./.env && set +a && bash scripts/mysql-full-backup.sh >>/var/log/maint-mysql-backup.log 2>&1
```

### Docker 日志按日扫描（可选）

```cron
25 0 * * * cd /srv/dinggu-room/supports/server-maintain && set -a && [ -f .env ] && . ./.env && set +a && /usr/bin/node scripts/analyze-docker-logs.mjs >>/var/log/maint-docker-logs.log 2>&1
```

（依赖 `.env` 中已配置 `DOCKER_LOG_CONTAINERS` 与可选 `REPORT_DIR`。查看单容器 json-file 物理路径：`docker inspect -f '{{.LogPath}}' <容器名>`。）

### Token 轮换（仅手动）

1. 备份 Caddy EnvironmentFile。
2. 预览：`node scripts/rotate-gate-tokens.mjs --dry-run`
3. 写回：`node scripts/rotate-gate-tokens.mjs --write --env-file /etc/caddy/caddy.env`
4. `sudo systemctl reload caddy`
5. 通知运营更新带 `entry_token` 的书签。`*_GATE_TOKEN_OLD` 在窗口期内仍接受旧 token。

`--maint-only` / `--op-only` 可只轮换一组。

## Caddy 环境变量（摘录）

与 [`templates/Caddyfile.split-domains.example`](../deploy/templates/Caddyfile.split-domains.example) 一致：

- **`OP_GATE_TOKEN`** 与 **`MAINT_GATE_TOKEN` 必须为两串不同的随机值**（后台 `op` 与运维 `maint` 独立书签、勿复用同一 token）。
- `MAINT_STATIC_ROOT`：静态根目录（与 `REPORT_DIR` 一致）
- `MAINT_GATE_TOKEN` / `MAINT_GATE_TOKEN_OLD`
- `OP_GATE_TOKEN` / `OP_GATE_TOKEN_OLD`

## 视觉

HTML 遵循叮谷海洋色（参见 `dinngoo-site/docs/dinngoo-design.md`）；图表使用 Chart.js CDN。

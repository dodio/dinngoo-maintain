# server-maintain 新机器部署（简要）

## 0. 目录约定（整站）

**根目录固定为** **`/srv/dinngoo-room`**（品牌 **dinngoo**，勿用旧拼写 `dinggu-room`）。各仓克隆路径如下（脚本与文档均按此编写，勿改目录名；若必须改用软链保持约定路径可用）：

| 路径 | 仓库 |
|------|------|
| `/srv/dinngoo-room/php-server` | `dodio/dinggu-admin-php` |
| `/srv/dinngoo-room/dinngoo-site` | `dodio/dinngoo-site` |
| `/srv/dinngoo-room/dinngoo-maintain` | `dodio/dinngoo-maintain`（本仓库） |

本仓库内日常工具目录：`/srv/dinngoo-room/dinngoo-maintain/server-maintain`。

## 1. 克隆

```bash
sudo mkdir -p /srv/dinngoo-room
sudo chown "$USER:$USER" /srv/dinngoo-room
cd /srv/dinngoo-room
git clone git@github.com:dodio/dinngoo-maintain.git
cd dinngoo-maintain/server-maintain
```

## 2. 环境变量

```bash
cp env.example .env
# 编辑 .env。若使用 dinngoo-rotate-gate-tokens --write，请保留 CADDY_ENV_FILE=/etc/caddy/env.deploy（与 Caddy systemd 一致）。
# 可选：python3 scripts/sync-mysql-password-from-php-server.py
```

## 3. sudo 包装 + 免密（无需参数）

须在约定路径下，由运维普通用户执行：

```bash
cd /srv/dinngoo-room/dinngoo-maintain
sudo bash deploy/install-dinngoo-server-maintain-wrappers.sh
```

脚本会校验仓库根是否为 **`/srv/dinngoo-room/dinngoo-maintain`**。用 `SUDO_USER`（或该目录属主）定免密用户，并解析 `node`（login shell → nvm → `/usr/bin/node`）、**`caddy`**（须已安装，常见 `/usr/bin/caddy`）。

生成：`/usr/local/sbin/dinngoo-rotate-gate-tokens`、`dinngoo-fetch-caddy-gate-tokens`、**`dinngoo-caddy-apply`**（从 **`deploy/staging/Caddyfile`** 安装系统 Caddyfile 并 reload；无暂存文件时仅校验当前配置并 reload），以及 `/etc/sudoers.d/dinngoo-server-maintain`。

升级 nvm 后：同上命令再执行一次。

### 3.1 Caddy 分域（勿长期保留默认「Caddy works!」页）

包管理器自带的 **`/etc/caddy/Caddyfile`** 通常只是 `:80` 演示站点；要让 **`www.dinngoo.com`** 反代到 Next（`127.0.0.1:13000`）等，需按 **`分域部署方案.md`** 落地：

1. **进程环境**：含门禁占位符的 Caddyfile 依赖 **`{$OP_GATE_TOKEN}`** 等。安装脚本会写入 **`/etc/systemd/system/caddy.service.d/env-deploy.conf`**（加载 **`/etc/caddy/env.deploy`**）。请在该文件中配置 token 与 **`MAINT_STATIC_ROOT`**（与 `server-maintain` 的 **`REPORT_DIR`** 一致），权限建议 **`chmod 600`**。**首次创建或修改 env 后请 `sudo systemctl restart caddy`**，再执行 **`sudo dinngoo-caddy-apply`**。
2. **站点配置**：将 **`templates/Caddyfile.split-domains.example`** 复制为 **`deploy/staging/Caddyfile`**（勿提交 Git），把其中 **`example.com`**、**`maint.dinngoo.xyz`** 等改为实际域名与 **`email`**。若 Caddy 2.6 校验报 **`roll_local_time`**，可删掉各 `log` 块中该行。确保 **`www` / `op` / `maint`** 的 DNS **A/AAAA** 指向本机。
3. **发布**：**`sudo dinngoo-caddy-apply`**（校验暂存文件、安装到 **`/etc/caddy/Caddyfile`** 并重载）。详见 **`deploy/staging/README.md`**。

## 4. 日常（运维用户）

**一次性**：配置 **日报（每日 02:00，统计昨天全天）**、**指标采集（约每 10 秒）** 与 **MySQL 全量备份（每日 02:00）** 的 cron（写入 `/etc/cron.d/dinngoo-server-maintain`）：

```bash
cd /srv/dinngoo-room/dinngoo-maintain
sudo bash deploy/install-dinngoo-maintain-cron.sh
```

说明与手动 crontab 片段见 **`server-maintain/README.md`**。

**整站 Docker（php-server 三服务 + dinngoo-site Next）** 在宿主依次启动：

```bash
cd /srv/dinngoo-room/dinngoo-maintain
bash deploy/start-dinngoo-docker-stacks.sh
```

**轮换门禁 token / 查看当前 token（按需，勿对轮换配 cron）**  
依赖 **`server-maintain/.env`** 中的 **`CADDY_ENV_FILE`**（通常为 **`/etc/caddy/env.deploy`**；脚本在未设置时若该路径文件存在也会自动使用）。**`--write`** 前请确认该文件已存在且 Caddy 已在使用：

```bash
dinngoo-rotate-gate-tokens --write
dinngoo-fetch-caddy-gate-tokens
```

**Caddy**：将待发布内容写入 **`deploy/staging/Caddyfile`**（普通用户可编辑，勿提交 Git），再 **`sudo dinngoo-caddy-apply`**（免密）。若仅改 **`/etc/caddy/env.deploy`**（如 token 轮换）而未动 Caddy 主配置：可不放暂存文件，直接 **`sudo dinngoo-caddy-apply`** 做校验并重载。详见 [`deploy/staging/README.md`](./staging/README.md)。

## 5. 自旧版路径/命令迁移（曾在 `/srv/dinggu-room` 或 `dinggu_*`）

1. 将三仓放到 **`/srv/dinngoo-room/...`**（或对该路径做 **`ln -s`**）。
2. Compose 共用网络改为 **`dinngoo_net`**（`docker network create dinngoo_net`；两栈 `docker-compose.prod.yml` 已按此命名）。旧容器需按窗口切换网络后重建或重连。
3. 删除旧包装与 sudoers（若存在）：`/usr/local/sbin/dinggu-rotate-gate-tokens`、`dinggu-fetch-caddy-gate-tokens`、`/etc/sudoers.d/dinggu-server-maintain`。曾安装过 **`dinngoo-caddy-validate-reload`** 的，再跑一次下方安装脚本会去掉旧包装、改为 **`dinngoo-caddy-apply`**。
4. 在 **`/srv/dinngoo-room/dinngoo-maintain`** 下重新执行 **`sudo bash deploy/install-dinngoo-server-maintain-wrappers.sh`**；更新 cron、`REPORT_DIR`、Caddy 等与路径相关的配置。

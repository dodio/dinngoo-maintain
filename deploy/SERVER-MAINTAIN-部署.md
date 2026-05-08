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
# 编辑 .env；可选：python3 scripts/sync-mysql-password-from-php-server.py
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

## 4. 日常（运维用户）

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

# 整站部署与运维（dinngoo-room）

本目录与 **`dinngoo-site`**、**`dinngoo-admin`** 等应用仓库**并列**，集中存放**跨项目**的架构说明、生产/测试环境运维、反代与安全留痕。  
各应用仓库**各自保留** `Dockerfile`、`docker-compose*.yml`、`deploy/*.example`、迁移 SQL 等**可执行配置**；此处仅描述**如何拼在一起**与运维约定。

> **2026-10-10 架构变更**：MySQL 独立为 **`dinngoo-db`** 栈（本目录 **`mysql/`**，运行时 `/srv/dinngoo-room/mysql`），
> **PHP（`php-server` 栈）下线**，`throne.dinngoo.xyz` 不再提供服务；`op.dinngoo.xyz` 指向新后台 `dinngoo-admin`（`127.0.0.1:13010`）。
> 迁移步骤与注意事项见 [**迁移-生产环境-数据库独立与php下线.md**](./迁移-生产环境-数据库独立与php下线.md)。

| 文档 | 用途 |
|------|------|
| [**服务容器部署文档索引.md**](./服务容器部署文档索引.md) | **dinngoo-db / dinngoo-site / dinngoo-admin** 各自 **`deploy/README.md`** 入口；`server-info` 与 `.gitignore` 说明 |
| [**分域部署方案.md**](./分域部署方案.md) | C 端 Next + 后台 Next + Caddy 分域与 `op` 门禁（历史 PHP 部分见文首说明） |
| [**mysql/**](./mysql/README.md) | 独立 MySQL（`dinngoo-db`）compose 模板、env 示例与卷说明 |
| [**安全事件排查总结-2026-05-02.md**](./安全事件排查总结-2026-05-02.md) | 备案期安全事件留痕（历史处置细节以正文为准） |
| [**templates/Caddyfile.split-domains.example**](./templates/Caddyfile.split-domains.example) | Caddy 分域 + 门禁 + 运维静态站 + 访问日志滚动模板（生产把 `example.com` 换成实际域即可；Caddy 2.6 若报 `roll_local_time` 可删掉该行） |
| [**SERVER-MAINTAIN-部署.md**](./SERVER-MAINTAIN-部署.md) | **server-maintain** 新机器：克隆路径、`.env`、**一次安装** sudo 包装与 NOPASSWD |
| [**install-dinngoo-server-maintain-wrappers.sh**](./install-dinngoo-server-maintain-wrappers.sh) | **零参数**；须在 **`/srv/dinngoo-room/dinngoo-maintain`** 下执行；生成 token 工具 + **`dinngoo-caddy-apply`**（从 [`staging/Caddyfile`](./staging/README.md) 安装系统 Caddy 并 reload） |
| [**install-dinngoo-maintain-cron.sh**](./install-dinngoo-maintain-cron.sh) | **零参数**、`sudo`；写入 **`/etc/cron.d/dinngoo-server-maintain`**：日报（每日 02:00，统计昨天）+ 指标（约每 10 秒）+ MySQL 全量备份（每日 02:00，`maint-mysql-backup.log`） |
| [**start-dinngoo-docker-stacks.sh**](./start-dinngoo-docker-stacks.sh) | 宿主依次启动 **`dinngoo-db`**（mysql）、**`dinngoo-site`**、**`dinngoo-admin`**；缺 standalone 时若存在 `npm` 会跑 `stage-standalone.sh` |
| [**staging/**](./staging/README.md) | 运维写入 **`Caddyfile` 暂存**，**`sudo dinngoo-caddy-apply`** 发布到 `/etc/caddy/` |
| [**sudoers.d-dinngoo-server-maintain.example**](./sudoers.d-dinngoo-server-maintain.example) | NOPASSWD 条目说明（**不必手填**，以安装脚本生成为准） |
| [**server-maintain/**](../server-maintain/README.md) | 日报 / 指标 JSON / MySQL 全量备份 / Docker 日志扫描 / 手动轮换 token |

**单机目录约定（根：`/srv/dinngoo-room`，勿改名）**

| 仓库 | 固定路径 |
|------|-----------|
| `dodio/dinggu-admin-php`（2026-10-10 起已下线，目录归档到 `/srv/dinngoo-room/_archive/`） | `/srv/dinngoo-room/php-server` |
| `dinngoo-db`（本仓 `deploy/mysql`，运行时目录另建） | `/srv/dinngoo-room/mysql` |
| `dodio/dinngoo-site` | `/srv/dinngoo-room/dinngoo-site` |
| `dodio/dinngoo-admin` | `/srv/dinngoo-room/dinngoo-admin` |
| 共享上传目录（原 `php-server/public/upload`） | `/srv/dinngoo-room/data/upload` |
| `dodio/dinngoo-maintain`（本仓） | `/srv/dinngoo-room/dinngoo-maintain`，工具在 `.../server-maintain` |

| 仓库 | 本目录文档中的约定 |
|------|-------------------|
| `dinngoo-db` | 独立 MySQL（数据卷 `dinngoo-db_mysql_data`；历史 php-server 迁移只在首次初始化空卷时执行） |
| `dinngoo-site` | Next：**standalone 部署目录**：`.next/standalone-runtime` |
| `dinngoo-admin` | 同上（新后台），另需邮件 `SMTP_*` / `MAIL_*` 环境变量 |

维护约定：整站流程、拓扑、测试机信息以 **`supports/deploy`** 为准更新；单项目镜像变量、Compose 服务名以**各仓库文件**为准。

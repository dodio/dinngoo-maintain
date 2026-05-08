# 整站部署与运维（dinngoo-room）

本目录与 **`php-server`**、**`dinngoo-site`** 仓库**并列**，集中存放**跨项目**的架构说明、生产/测试环境运维、反代与安全留痕。  
两个应用仓库**各自保留** `Dockerfile`、`docker-compose*.yml`、`deploy/*.example`、迁移 SQL 等**可执行配置**；此处仅描述**如何拼在一起**与运维约定。

| 文档 | 用途 |
|------|------|
| [**分域部署方案.md**](./分域部署方案.md) | C 端 Next + 后台 PHP + Caddy 分域与 `op` 门禁 |
| [**安全事件排查总结-2026-05-02.md**](./安全事件排查总结-2026-05-02.md) | 备案期安全事件留痕（历史处置细节以正文为准） |
| [**templates/Caddyfile.split-domains.example**](./templates/Caddyfile.split-domains.example) | Caddy 分域 + 门禁 + 运维静态站 + 访问日志滚动模板 |
| [**SERVER-MAINTAIN-部署.md**](./SERVER-MAINTAIN-部署.md) | **server-maintain** 新机器：克隆路径、`.env`、**一次安装** sudo 包装与 NOPASSWD |
| [**install-dinngoo-server-maintain-wrappers.sh**](./install-dinngoo-server-maintain-wrappers.sh) | **零参数**；须在 **`/srv/dinngoo-room/dinngoo-maintain`** 下执行 |
| [**sudoers.d-dinngoo-server-maintain.example**](./sudoers.d-dinngoo-server-maintain.example) | NOPASSWD 条目说明（**不必手填**，以安装脚本生成为准） |
| [**server-maintain/**](../server-maintain/README.md) | 日报 / 指标 JSON / MySQL 全量备份 / Docker 日志扫描 / 手动轮换 token |

**单机目录约定（根：`/srv/dinngoo-room`，勿改名）**

| 仓库 | 固定路径 |
|------|-----------|
| `dodio/dinggu-admin-php` | `/srv/dinngoo-room/php-server` |
| `dodio/dinngoo-site` | `/srv/dinngoo-room/dinngoo-site` |
| `dodio/dinngoo-maintain`（本仓） | `/srv/dinngoo-room/dinngoo-maintain`，工具在 `.../server-maintain` |

| 仓库 | 本目录文档中的约定 |
|------|-------------------|
| `php-server` | MySQL、PHP-FPM、Nginx、**SQL 迁移** |
| `dinngoo-site` | Next：**standalone 部署目录**：`.next/standalone-runtime` |

维护约定：整站流程、拓扑、测试机信息以 **`supports/deploy`** 为准更新；单项目镜像变量、Compose 服务名以**各仓库文件**为准。

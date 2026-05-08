# 整站部署与运维（dinggu-room）

本目录与 **`php-server`**、**`dinngoo-site`** 仓库**并列**，集中存放**跨项目**的架构说明、生产/测试环境运维、反代与安全留痕。  
两个应用仓库**各自保留** `Dockerfile`、`docker-compose*.yml`、`deploy/*.example`、迁移 SQL 等**可执行配置**；此处仅描述**如何拼在一起**与运维约定。

| 文档 | 用途 |
|------|------|
| [**分域部署方案.md**](./分域部署方案.md) | C 端 Next + 后台 PHP + Caddy 分域与 `op` 门禁 |
| [**测试环境部署和更新维护.md**](./测试环境部署和更新维护.md) | 当前测试机目录、端口、Compose、DB 迁移、日常更新 |
| [**安全事件排查总结-2026-05-02.md**](./安全事件排查总结-2026-05-02.md) | 备案期安全事件留痕（历史处置细节以正文为准） |
| [**templates/Caddyfile.split-domains.example**](./templates/Caddyfile.split-domains.example) | Caddy 分域 + 门禁模板（复制到主机 `/etc/caddy/` 等后修改） |

**仓库对照（默认单机路径示例）**

| 仓库 | 典型部署目录 | 本目录文档中的约定 |
|------|----------------|-------------------|
| `php-server` | `/srv/dinggu-room/php-server` | MySQL、PHP-FPM、Nginx、**SQL 迁移** |
| `dinngoo-site` | `/srv/dinggu-room/dinngoo-site` | Next：**standalone 部署目录**：`.next/standalone-runtime` |

维护约定：整站流程、拓扑、测试机信息以 **`supports/deploy`** 为准更新；单项目镜像变量、Compose 服务名以**各仓库文件**为准。

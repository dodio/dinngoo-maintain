# 独立 MySQL（dinngoo-db）

2026-10-10 起，MySQL 从 `php-server` 的 compose 栈中拆出，独立部署在
**`/srv/dinngoo-room/mysql/`**，供 `dinngoo-site`（C 端）与 `dinngoo-admin`（新后台）共用。
同日起 PHP 下线，`throne.dinngoo.xyz` 不再提供入口。

## 目录约定

| 路径 | 说明 |
|------|------|
| `/srv/dinngoo-room/mysql/docker-compose.prod.yml` | compose（项目名 `dinngoo-db`，服务名 `mysql`） |
| `/srv/dinngoo-room/mysql/.env` | `MYSQL_ROOT_PASSWORD` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD`，权限 600 |
| `/srv/dinngoo-room/mysql/init/` | 首次初始化空数据目录时执行（导入 seed、按序执行 migrations） |
| `/srv/dinngoo-room/mysql/migrations/` | 历史 php-server 迁移（已全部应用）；仅首次初始化时执行 |
| `/srv/dinngoo-room/mysql/seed/` | 对应原 `php-server/public/data`（当前为空） |

## 数据卷

- 运行时卷 **`dinngoo-db_mysql_data`**，在 compose 中声明为 **外部卷**：卷不存在时 compose 直接报错，
  避免误起一个空库。
- 迁移方式：停旧栈 → `docker volume create dinngoo-db_mysql_data` → 用临时容器 `cp -a`
  从 `php-server_mysql_data` 复制 → 比对大小。
- **旧卷 `php-server_mysql_data` 保留不删**，是迁移前的数据快照，用于回滚。
- 镜像必须保持 `mysql:5.7` + `platform: linux/amd64`：数据目录与版本强绑定，换版本会拒绝启动。

## 常用命令

```bash
cd /srv/dinngoo-room/mysql
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100 mysql
```

备份与指标采集见 `supports/server-maintain/`（`MYSQLDUMP_COMPOSE_FILE` 指向本目录的 compose）。

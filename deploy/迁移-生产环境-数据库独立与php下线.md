# 生产环境迁移：数据库独立部署 + PHP 下线 + throne 域名移除

> 本文是 **runbook**，供在生产机执行时逐步照做。测试环境已于 2026-10-10 按同一流程完成，
> 实测记录见 [执行报告](../docs/2026-10-10-数据库独立与php下线-执行报告.md)。
>
> **前置确认**：迁移会中断服务（需可接受的停机窗口）；旧数据卷**不会被删除**；执行前必须有可用的全量备份。

## 0. 与测试环境的差异（先对齐）

| 项 | 测试环境 | 生产环境（按实际填写） |
|----|----------|------------------------|
| 域名 | `www/op/maint/throne.dinngoo.xyz` | `www/op/maint.<主域名>`（本仓例：`dinngoo.com`），**无 throne** |
| 部署根目录 | `/srv/dinngoo-room` | 同（若不同，全文替换） |
| 目录用户 | `dinngoo` | 以实际运维用户为准 |
| 运维栈 | **未部署** `dinngoo-maintain` | 若已部署，须同步其 runtime `.env`（见 §8） |
| 附件目录权限 | 宿主 `777` | 须核对：新后台容器以 uid **1000** 运行，需对该目录可写 |

## 1. 备份与基线

```bash
BK=/srv/dinngoo-room/backups/pre-migration-$(date +%Y%m%d)
mkdir -p "$BK" /srv/dinngoo-room/backups/mysql
cp -a /etc/caddy/Caddyfile "$BK/Caddyfile"
cp -a /srv/dinngoo-room/dinngoo-admin/.env.production.local "$BK/admin.env.production.local"
cp -a /srv/dinngoo-room/dinngoo-site/.env.production.local "$BK/site.env.production.local"
cp -a /srv/dinngoo-room/php-server/.env "$BK/php-server.env"
cp -a /srv/dinngoo-room/dinngoo-admin/docker-compose.prod.yml "$BK/admin-compose.yml"
cp -a /srv/dinngoo-room/dinngoo-site/docker-compose.prod.yml "$BK/site-compose.yml"
cp -a /srv/dinngoo-room/php-server/docker-compose.prod.yml "$BK/php-compose.yml"
```

全量 dump（把结果记进变更单，后续每步都拿它对照）：

```bash
cd /srv/dinngoo-room/php-server
set -a; . ./.env; set +a
OUT=/srv/dinngoo-room/backups/mysql/room_controll_$(date +%Y%m%d-%H%M%S).sql.gz
sudo docker compose -f docker-compose.prod.yml exec -T mysql \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction \
  --default-character-set=utf8mb4 --routines --triggers room_controll | gzip -c > "$OUT"
gzip -t "$OUT" && echo DUMP_OK
```

记录基线（表数、关键表行数、附件文件数与字节数）：

```bash
sudo docker exec -i php-server-mysql-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B room_controll \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();"
find /srv/dinngoo-room/php-server/public/upload -type f | wc -l
du -sb /srv/dinngoo-room/php-server/public/upload
```

## 2. 停旧栈并复制数据卷

```bash
cd /srv/dinngoo-room/php-server
sudo docker compose -f docker-compose.prod.yml down        # 不要加 -v，卷要保留
docker volume ls | grep mysql                              # 确认 php-server_mysql_data 仍在

sudo docker volume create dinngoo-db_mysql_data
sudo docker run --rm \
  -v php-server_mysql_data:/from \
  -v dinngoo-db_mysql_data:/to \
  alpine sh -c 'cd /from && cp -a . /to/ && echo COPY_DONE'

# 必须逐字节一致才算成功
sudo docker run --rm -v php-server_mysql_data:/d alpine du -sb /d
sudo docker run --rm -v dinngoo-db_mysql_data:/d alpine du -sb /d
```

> **旧卷 `php-server_mysql_data` 保持原样**，它是本步骤唯一的回滚快照，至少保留一个稳定周期。

## 3. 建立独立 MySQL 目录

```bash
mkdir -p /srv/dinngoo-room/mysql
cd /srv/dinngoo-room/mysql
# 从本仓模板复制（supports/deploy/mysql/）：docker-compose.prod.yml / env.example / README.md
cp env.example .env      # 再填入 MYSQL_ROOT_PASSWORD / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD
chmod 600 .env

# 保留首次初始化能力（数据卷非空时不会触发）
cp -a /srv/dinngoo-room/php-server/docker/mysql/init ./init
cp -a /srv/dinngoo-room/php-server/migrations ./migrations
cp -a /srv/dinngoo-room/php-server/public/data ./seed

sudo docker compose -f docker-compose.prod.yml config -q && echo CONFIG_OK
sudo docker compose -f docker-compose.prod.yml up -d
for i in $(seq 1 30); do
  s=$(sudo docker inspect dinngoo-db-mysql-1 --format '{{.State.Health.Status}}'); echo "$s"
  [ "$s" = healthy ] && break; sleep 5
done
```

要点：数据卷在 compose 中声明为**外部卷** `dinngoo-db_mysql_data`（`external: true`）——卷不存在时 compose 直接报错，
避免误起一个空库；镜像必须保持 **`mysql:5.7` + `platform: linux/amd64`**，数据目录与版本强绑定。

## 4. 迁移附件目录

```bash
mkdir -p /srv/dinngoo-room/data
cp -a /srv/dinngoo-room/php-server/public/upload /srv/dinngoo-room/data/upload
# 校验
find /srv/dinngoo-room/php-server/public/upload -type f | wc -l
find /srv/dinngoo-room/data/upload -type f | wc -l
du -sb /srv/dinngoo-room/data/upload
# 新后台容器以 uid 1000 运行，确保可写
sudo chmod -R a+rwX /srv/dinngoo-room/data/upload
```

## 5. 更新两个应用并启动

两个应用仓库需包含这两处改动（测试环境对应 commit：admin `e8c81fb`、site `3b144a3`）：

- 挂载：`../data/upload:/dinggu-upload:rw`（admin）/ `:ro`（site）
- 环境：`UPLOAD_LOCAL_ROOT=/dinggu-upload`

```bash
for d in dinngoo-admin dinngoo-site; do
  cd /srv/dinngoo-room/$d && git pull --ff-only && git log -1 --oneline
done

cd /srv/dinngoo-room/dinngoo-admin && sudo docker compose -f docker-compose.prod.yml up -d next
cd /srv/dinngoo-room/dinngoo-site  && sudo docker compose -f docker-compose.prod.yml up -d next
```

> 挂载变了必须用 `up -d`（重建容器），`restart` 不会应用新挂载。

## 6. 邮件配置迁入新后台

来源：PHP 的 `php-server/application/config_local/mail_config.local.php`（**gitignore，仅存在于机器/密钥库**）。
需写入 `dinngoo-admin/.env.production.local` 的 18 个键：

```
SMTP_HOST SMTP_PORT SMTP_AUTH SMTP_CHARSET SENDER_NAME REPLYER_NAME
SENDER_NAME_HOTEL REPLYER_NAME_HOTEL SMTP_USER_NAME_HOTEL SMTP_PASSWORD_HOTEL MAIL_FROM_HOTEL MAIL_REPLY_HOTEL
SENDER_NAME_CUSTOMER REPLYER_NAME_CUSTOMER SMTP_USER_NAME_CUSTOMER SMTP_PASSWORD_CUSTOMER MAIL_FROM_CUSTOMER MAIL_REPLY_CUSTOMER
```

注意：`SMTP_AUTH` 写 `1`（仅 `0`/`false` 视为关闭）；`MAIL_REPLY_*` 为必填；`SMTP_PORT=465` 时后台自动 SSL；php 的 `MAIL_BODY` 不需要。
改完 `sudo docker compose -f docker-compose.prod.yml up -d next`，并请业务方验证发信。

## 7. Caddy 去掉 throne（若生产当前存在该域名）

```bash
sudo cp -a /etc/caddy/Caddyfile /tmp/Caddyfile.$(date +%Y%m%d%H%M%S)
# 编辑 /etc/caddy/Caddyfile，删除整个 throne.<主域名> 站点块
sudo systemctl reload caddy
systemctl is-active caddy
```

校验：`op` 无 token 404、带 token 可进；`www` / `maint` 正常；`throne` TLS 握手失败（无站点块即无证书）。
**随后在 DNS 服务商删除 throne 的 A 记录。**

> 不要以 root 运行 `caddy validate`（会在 `/var/log/caddy/` 留下 root:600 日志，导致 caddy 启动失败）；
> 需要校验时用 `systemctl reload caddy`（其 ExecReload 自带校验且带 `env.deploy` 环境）。

## 8. 运维脚本与参数（若生产已部署 dinngoo-maintain）

同步 `dinngoo-maintain/server-maintain/.env`：

```
MYSQLDUMP_COMPOSE_FILE=/srv/dinngoo-room/mysql/docker-compose.prod.yml
DOCKER_LOG_CONTAINERS=dinngoo-db-mysql-1,dinngoo-site-next-1,dinngoo-admin-next-1
REPORT_DOCKER_LOG_SERVICES=dinngoo-site-next-1,dinngoo-admin-next-1
# CADDY_WWW_ACCESS_GLOB / CADDY_OP_ACCESS_GLOB 不变
```

并 `git pull` 本仓以取得：`deploy/start-dinngoo-docker-stacks.sh`（已改为起 db+site+admin）、
`server-maintain/scripts/sync-mysql-password-from-db-env.py`（替代旧的 php-server 版本）、
`server-maintain/scripts/mysql-full-backup.sh`、`server-maintain/scripts/analyze-docker-logs.mjs`、
`deploy/templates/Caddyfile.split-domains.example`。

> **重要**：若生产使用了 `dinngoo-caddy-apply`，它会用 `deploy/staging/Caddyfile` 覆盖 `/etc/caddy/Caddyfile`；
> 请同步更新该暂存文件或删除它，否则一次 apply 会把域名改动回滚。

## 9. 验收清单

- [ ] 表数与关键表行数与基线一致；两个应用核心页面无数据库错误
- [ ] C 端能读到 `/upload/...` 图片；新后台上传文件后宿主机 `data/upload` 可见且能读回
- [ ] 业务方验证发信成功（`snake_smail.sendResult=1`）
- [ ] `mysql-full-backup.sh` / 日报 / 指标 / 容器日志扫描全部正常
- [ ] `op` 无 token 404、带 token 正常；`www`、`maint` 正常；`throne` 不再服务
- [ ] DNS 已删除 throne 记录
- [ ] `php-server` 目录已归档、旧卷保留

## 10. 回滚

1. `docker compose -f /srv/dinngoo-room/mysql/docker-compose.prod.yml down`（不带 `-v`）。
2. 还原归档：`mv /srv/dinngoo-room/_archive/php-server-<日期> /srv/dinngoo-room/php-server`。
3. `cd /srv/dinngoo-room/php-server && docker compose -f docker-compose.prod.yml up -d`（挂旧卷，数据为迁移前状态）。
4. 两个应用仓库 `git revert` 并 `up -d`；`.env.production.local`、`/etc/caddy/Caddyfile` 从 `$BK` 还原后 `systemctl reload caddy`。
5. 附件 `data/upload` 与旧路径并存，无需搬回；确认无误后再清理新卷与新目录。

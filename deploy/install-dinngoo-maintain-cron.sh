#!/usr/bin/env bash
# 安装 server-maintain 的 cron（需 root）：日报与 MySQL 备份均在每日 02:00（日报统计「昨天」全天）；指标约每 10 秒。
# 须在约定路径执行：/srv/dinngoo-room/dinngoo-maintain（与 install-dinngoo-server-maintain-wrappers.sh 一致）。
#
#   cd /srv/dinngoo-room/dinngoo-maintain
#   sudo bash deploy/install-dinngoo-maintain-cron.sh
#
set -euo pipefail

[[ "${EUID:-0}" -eq 0 ]] || {
	echo "错误: 请执行 sudo bash $0（由运维用户 sudo，勿事先 sudo su）" >&2
	exit 1
}

DINNGOO_SRV_ROOT="/srv/dinngoo-room"
CONVENTION_MAINTAIN="${DINNGOO_SRV_ROOT}/dinngoo-maintain"
SM="${CONVENTION_MAINTAIN}/server-maintain"
CRON_D="/etc/cron.d/dinngoo-server-maintain"

die() { echo "错误: $*" >&2; exit 1; }

[[ -d "${SM}" ]] || die "未找到 ${SM}，请先按 SERVER-MAINTAIN-部署.md 克隆到约定目录"
[[ -f "${SM}/scripts/cron-daily-report-yesterday.sh" ]] || die "缺少 ${SM}/scripts/cron-daily-report-yesterday.sh"
[[ -f "${SM}/scripts/cron-daily-report-end-of-day.sh" ]] || die "缺少 ${SM}/scripts/cron-daily-report-end-of-day.sh"
[[ -f "${SM}/scripts/run-metrics-loop-minute.sh" ]] || die "缺少 ${SM}/scripts/run-metrics-loop-minute.sh"
[[ -f "${SM}/scripts/mysql-full-backup.sh" ]] || die "缺少 ${SM}/scripts/mysql-full-backup.sh"
[[ -f "${SM}/scripts/cron-mysql-backup-daily.sh" ]] || die "缺少 ${SM}/scripts/cron-mysql-backup-daily.sh"

chmod 755 "${SM}/scripts/cron-daily-report-yesterday.sh" "${SM}/scripts/cron-daily-report-end-of-day.sh" "${SM}/scripts/run-metrics-loop-minute.sh" "${SM}/scripts/cron-mysql-backup-daily.sh"

RUNAS_USER="${SUDO_USER:-}"
if [[ -z "${RUNAS_USER}" || "${RUNAS_USER}" == root ]]; then
	RUNAS_USER="$(stat -c '%U' "${CONVENTION_MAINTAIN}" 2>/dev/null || true)"
fi
[[ -n "${RUNAS_USER}" && "${RUNAS_USER}" != root ]] || die "无法确定运维用户。请用普通账号执行「sudo bash $0」"
id "${RUNAS_USER}" &>/dev/null || die "系统无此用户: ${RUNAS_USER}"

touch /var/log/maint-report.log /var/log/maint-metrics.log /var/log/maint-mysql-backup.log
chown "${RUNAS_USER}": /var/log/maint-report.log /var/log/maint-metrics.log /var/log/maint-mysql-backup.log

cat >"${CRON_D}" <<EOF
# dinngoo server-maintain — 由 install-dinngoo-maintain-cron.sh 生成；勿手改（可再执行安装脚本覆盖）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 日报：每日 02:00，统计「昨天」自然日 00:00～23:59（generate-daily-report.mjs 默认；TZ 见 cron-daily-report-yesterday.sh）
0 2 * * * ${RUNAS_USER} ${SM}/scripts/cron-daily-report-yesterday.sh >>/var/log/maint-report.log 2>&1

# 性能/指标：每分钟 6 次 collect-metrics，间隔约 10 秒
* * * * * ${RUNAS_USER} ${SM}/scripts/run-metrics-loop-minute.sh >>/var/log/maint-metrics.log 2>&1

# MySQL 全量备份：每日 02:00（依赖 server-maintain/.env）
0 2 * * * ${RUNAS_USER} ${SM}/scripts/cron-mysql-backup-daily.sh
EOF
chmod 644 "${CRON_D}"

echo "已写入 ${CRON_D}"
echo "  运维用户: ${RUNAS_USER}"
echo "  日报: ${SM}/scripts/cron-daily-report-yesterday.sh → /var/log/maint-report.log"
echo "  指标: ${SM}/scripts/run-metrics-loop-minute.sh → /var/log/maint-metrics.log"
echo "  MySQL: ${SM}/scripts/cron-mysql-backup-daily.sh → /var/log/maint-mysql-backup.log"
echo "确认: sudo run-parts --test /etc/cron.d 2>/dev/null || true"

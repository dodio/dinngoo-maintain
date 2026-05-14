# Caddy 配置暂存（仅本机 / CI 使用）

把 **待上线** 的 `Caddyfile` 放在本目录 **`Caddyfile`**（与仓库 `deploy/templates/` 范例对齐后另存为即可）。  
**勿提交** Git（见 `.gitignore`）。

应用方式（须已执行 [`install-dinngoo-server-maintain-wrappers.sh`](../install-dinngoo-server-maintain-wrappers.sh)）：

```bash
# 写入或更新本目录下的 Caddyfile 后（普通用户可写）：
sudo dinngoo-caddy-apply
```

脚本行为简述：

1. 若 **`Caddyfile` 存在且非空**：先加载 **`/etc/caddy/env.deploy`** 做占位符校验 → `caddy validate` 暂存文件 → 备份并 **`install` 到 `/etc/caddy/Caddyfile`** → 再校验 → **`systemctl reload caddy`**。校验失败则恢复备份。
2. 若 **未放置暂存文件**（例如仅轮换过 `env.deploy`）：对 **当前** `/etc/caddy/Caddyfile` 校验后 **reload**。

**不**在此目录放口令；`env.deploy` 仍由你在服务器上用 **`sudo`** 维护，或通过既有的 token 轮换脚本写回。

**maint** 静态站在范例中已使用 **`file_server browse`**（目录列表）：整站仍有 **entry_token + `maint_gate` cookie**，访问时请直接打开带后缀的路径，例如 **`/dashboard.html`**、**`/daily-report.html?date=YYYY-MM-DD`**、**`/daily-report-stats.html`**。

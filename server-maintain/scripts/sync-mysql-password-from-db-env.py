#!/usr/bin/env python3
"""将独立 MySQL 栈的 .env 中 MYSQL_USER / MYSQL_PASSWORD 合并到 server-maintain/.env（不写出口令）。

2026-10-10 起 MySQL 已从 php-server 栈拆出为 dinngoo-db（/srv/dinngoo-room/mysql/.env），
故口令来源改为该文件；可用 DINNGOO_DB_ENV 覆盖路径。

备份脚本须与应用库用户一致（通常为 room），勿仅用 root + 应用口令。
"""
import os
import re
import sys
from pathlib import Path

DINNGOO_SRV = Path("/srv/dinngoo-room")


def main() -> int:
    db_env = Path(os.environ.get("DINNGOO_DB_ENV") or DINNGOO_SRV / "mysql" / ".env")
    maint_path = DINNGOO_SRV / "dinngoo-maintain" / "server-maintain" / ".env"
    if not db_env.is_file():
        print("missing", db_env, file=sys.stderr)
        return 1
    if not maint_path.is_file():
        print("missing", maint_path, file=sys.stderr)
        return 1

    raw = db_env.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"^MYSQL_PASSWORD=(.*)$", raw, re.MULTILINE)
    if not m:
        print(f"no MYSQL_PASSWORD in {db_env}", file=sys.stderr)
        return 1

    um = re.search(r"^MYSQL_USER=(.*)$", raw, re.MULTILINE)
    user_val = um.group(1).strip() if um else ""
    if user_val and ((user_val.startswith('"') and user_val.endswith('"')) or (user_val.startswith("'") and user_val.endswith("'"))):
        user_val = user_val[1:-1]

    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    if not val or re.search(r'[\s#"\'\\]', val):
        safe = '"' + val.replace("\\", "\\\\").replace('"', '\\"') + '"'
    else:
        safe = val

    maint = maint_path.read_text(encoding="utf-8", errors="replace")
    if re.search(r"^MYSQL_PASSWORD=", maint, re.MULTILINE):
        maint_n = re.sub(
            r"^MYSQL_PASSWORD=.*$",
            "MYSQL_PASSWORD=" + safe,
            maint,
            count=1,
            flags=re.MULTILINE,
        )
    else:
        maint_n = maint.rstrip() + "\nMYSQL_PASSWORD=" + safe + "\n"

    if user_val and not re.search(r'[\s#"\'\\]', user_val):
        if re.search(r"^MYSQL_USER=", maint_n, re.MULTILINE):
            maint_n = re.sub(
                r"^MYSQL_USER=.*$",
                "MYSQL_USER=" + user_val,
                maint_n,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            maint_n = maint_n.rstrip() + "\nMYSQL_USER=" + user_val + "\n"

    maint_path.write_text(maint_n, encoding="utf-8")
    print(
        f"ok: MYSQL_PASSWORD synced from {db_env} (value not shown)"
        + (f"; MYSQL_USER={user_val}" if user_val else ""),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

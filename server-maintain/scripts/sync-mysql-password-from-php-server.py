#!/usr/bin/env python3
"""将 php-server/.env 中的 MYSQL_PASSWORD 合并到 server-maintain/.env（不写出口令）。

路径固定为 deploy/SERVER-MAINTAIN-部署.md 中的 /srv/dinngoo-room 约定。
"""
import re
import sys
from pathlib import Path

DINNGOO_SRV = Path("/srv/dinngoo-room")


def main() -> int:
    php_path = DINNGOO_SRV / "php-server" / ".env"
    maint_path = DINNGOO_SRV / "dinngoo-maintain" / "server-maintain" / ".env"
    if not php_path.is_file():
        print("missing", php_path, file=sys.stderr)
        return 1
    if not maint_path.is_file():
        print("missing", maint_path, file=sys.stderr)
        return 1

    raw = php_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"^MYSQL_PASSWORD=(.*)$", raw, re.MULTILINE)
    if not m:
        print("no MYSQL_PASSWORD in php-server/.env", file=sys.stderr)
        return 1

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

    maint_path.write_text(maint_n, encoding="utf-8")
    print("ok: MYSQL_PASSWORD synced from php-server/.env (value not shown)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

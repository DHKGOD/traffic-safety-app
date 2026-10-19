"""管理專案資料夾內的 PostgreSQL（DB_MODE=local 時使用）。

    uv run python scripts/localdb.py init     # 第一次：建立 db/pgdata（initdb）
    uv run python scripts/localdb.py start
    uv run python scripts/localdb.py stop
    uv run python scripts/localdb.py status
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, env, pg_tool, project_path  # noqa: E402

PGDATA = project_path(env("PGDATA", "db/pgdata"))
LOG = ROOT / "db" / "postgres.log"
PORT = env("POSTGRES_PORT", "5432")

HBA_HEADER = """# --- 專案設定（scripts/localdb.py 產生）---
# MCP 唯讀帳號：只允許本機、只能讀 traffic 資料庫（權限在資料庫內另外限制為 SELECT）
host    traffic         mcp_readonly    127.0.0.1/32            trust
host    traffic         mcp_readonly    ::1/128                 trust
# 其餘一律需要密碼
"""


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, text=True, capture_output=True, encoding="utf-8", errors="replace")


def is_initialized() -> bool:
    return (PGDATA / "PG_VERSION").exists()


def init() -> None:
    if is_initialized():
        print(f"資料目錄已存在：{PGDATA}")
        return
    PGDATA.parent.mkdir(parents=True, exist_ok=True)
    pw = env("POSTGRES_SUPERUSER_PASSWORD")
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".pw", encoding="utf-8") as f:
        f.write(pw + "\n")
        pwfile = f.name
    try:
        r = run([pg_tool("initdb"), "-D", str(PGDATA), "-U", env("POSTGRES_SUPERUSER", "postgres"),
                 "--auth=scram-sha-256", f"--pwfile={pwfile}", "--encoding=UTF8", "--no-locale"], check=False)
    finally:
        os.unlink(pwfile)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        raise SystemExit("initdb 失敗")
    with (PGDATA / "postgresql.conf").open("a", encoding="utf-8") as f:
        f.write("\n# --- 專案設定 ---\n"
                "listen_addresses = 'localhost'   # 只給本機的 API 用；手機連 API，不直接連資料庫\n"
                f"port = {PORT}\n"
                "shared_buffers = 256MB\n"
                "work_mem = 32MB\n"
                "maintenance_work_mem = 256MB\n"
                "timezone = 'Asia/Taipei'\n"
                "log_timezone = 'Asia/Taipei'\n")
    hba = PGDATA / "pg_hba.conf"
    hba.write_text(HBA_HEADER + hba.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"已建立資料目錄：{PGDATA}")


def status() -> bool:
    if not is_initialized():
        return False
    return run([pg_tool("pg_ctl"), "-D", str(PGDATA), "status"], check=False).returncode == 0


def start() -> None:
    if not is_initialized():
        init()
    if status():
        print("PostgreSQL 已在執行中。")
        return
    LOG.parent.mkdir(parents=True, exist_ok=True)
    # 用 Popen 而非 run：Windows 上 postgres 子行程會繼承 pipe，等待輸出會卡住
    p = subprocess.Popen([pg_tool("pg_ctl"), "-D", str(PGDATA), "-l", str(LOG), "-w", "-t", "60", "start"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    if p.wait() != 0:
        print(LOG.read_text(encoding="utf-8", errors="replace")[-2000:] if LOG.exists() else "")
        raise SystemExit("PostgreSQL 啟動失敗，請看 db/postgres.log")
    print(f"PostgreSQL 已啟動（port {PORT}，資料目錄 {PGDATA.relative_to(ROOT)}）")


def stop() -> None:
    if not status():
        print("PostgreSQL 沒有在執行。")
        return
    run([pg_tool("pg_ctl"), "-D", str(PGDATA), "-m", "fast", "-w", "stop"])
    print("PostgreSQL 已停止。")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "init":
        init()
    elif cmd == "start":
        start()
    elif cmd == "stop":
        stop()
    elif cmd == "status":
        print("執行中" if status() else "未執行")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

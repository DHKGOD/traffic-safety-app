"""腳本共用：讀取 .env、路徑、資料庫連線。"""
from __future__ import annotations

import os
import shutil
import socket
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key, default)
    if val is None:
        raise SystemExit(f"缺少設定 {key}，請檢查 .env（可參考 .env.example）")
    return val


def project_path(value: str) -> Path:
    """.env 中的相對路徑一律相對於專案根目錄。"""
    p = Path(value)
    return p if p.is_absolute() else ROOT / p


def pg_tool(name: str) -> str:
    """找 PostgreSQL 執行檔：.env 的 PG_BIN → scripts/install_postgres.ps1 的安裝位置 → PATH。

    註：Windows 版 PostgreSQL 的程式路徑不能含中文（initdb 會失敗），
    所以程式本體裝在 %LOCALAPPDATA%\\Programs\\pgsql18，資料目錄仍在專案內。
    """
    exe = name + (".exe" if os.name == "nt" else "")
    candidates = []
    if os.environ.get("PG_BIN"):
        candidates.append(project_path(os.environ["PG_BIN"]))
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        candidates.append(Path(os.environ["LOCALAPPDATA"]) / "Programs" / "pgsql18" / "bin")
    for d in candidates:
        if (d / exe).exists():
            return str(d / exe)
    found = shutil.which(name)
    if not found:
        raise SystemExit(f"找不到 {name}，請安裝 PostgreSQL 或設定 PG_BIN")
    return found


def database_url() -> str:
    return env("DATABASE_URL")


def superuser_conninfo(dbname: str | None = None) -> str:
    from psycopg.conninfo import make_conninfo
    return make_conninfo(
        host=env("POSTGRES_HOST", "127.0.0.1"), port=env("POSTGRES_PORT", "5432"),
        user=env("POSTGRES_SUPERUSER", "postgres"), password=env("POSTGRES_SUPERUSER_PASSWORD", ""),
        dbname=dbname or "postgres",
    )


def lan_ips() -> list[str]:
    """找出本機區網 IPv4（給手機連線用）。"""
    ips: list[str] = []
    try:  # 主要路由介面
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith(("127.", "169.254.")):
                ips.append(ip)
    except OSError:
        pass
    return ips

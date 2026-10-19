"""建立資料庫、App 帳號、MCP 唯讀帳號與 extension（需超級使用者；可重複執行）。

    uv run python scripts/db_bootstrap.py

external 模式若沒有超級使用者權限：請主機管理員依 docs/deploy-cloud.md 手動建立
資料庫與帳號後，略過此步驟直接執行 migrate.py。
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import env, superuser_conninfo  # noqa: E402


def main() -> int:
    db = env("POSTGRES_DB", "traffic")
    app_user = env("APP_DB_USER", "traffic_app")
    app_pw = env("APP_DB_PASSWORD")

    with psycopg.connect(superuser_conninfo(), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (app_user,)).fetchone()
        stmt = "ALTER ROLE {} WITH LOGIN PASSWORD {}" if exists else "CREATE ROLE {} WITH LOGIN PASSWORD {}"
        conn.execute(sql.SQL(stmt).format(sql.Identifier(app_user), sql.Literal(app_pw)))
        print(f"帳號 {app_user}：{'已更新密碼' if exists else '已建立'}")

        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname='mcp_readonly'").fetchone():
            conn.execute("CREATE ROLE mcp_readonly WITH LOGIN")
            print("帳號 mcp_readonly：已建立（唯讀，只允許本機）")

        if not conn.execute("SELECT 1 FROM pg_database WHERE datname=%s", (db,)).fetchone():
            conn.execute(sql.SQL("CREATE DATABASE {} OWNER {} ENCODING 'UTF8' TEMPLATE template0")
                         .format(sql.Identifier(db), sql.Identifier(app_user)))
            print(f"資料庫 {db}：已建立")

    with psycopg.connect(superuser_conninfo(db), autocommit=True) as conn:
        available = conn.execute("SELECT 1 FROM pg_available_extensions WHERE name='postgis'").fetchone()
        if available:
            conn.execute("CREATE EXTENSION IF NOT EXISTS postgis")
            ver = conn.execute("SELECT postgis_lib_version()").fetchone()[0]
            print(f"PostGIS {ver}：已啟用")
        else:
            print("此主機沒有 PostGIS，將使用一般 SQL 的替代空間查詢（功能相同，速度較慢）")
        conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO mcp_readonly").format(sql.Identifier(db)))
        conn.execute("GRANT USAGE ON SCHEMA public TO mcp_readonly")
        conn.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(app_user)))
        conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly")
        conn.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly")
                     .format(sql.Identifier(app_user)))
    print("bootstrap 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())

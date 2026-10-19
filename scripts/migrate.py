"""依序套用 migrations/*.sql（記錄在 schema_migrations，已套用的會跳過）。

    uv run python scripts/migrate.py            # 套用尚未套用的 migration
    uv run python scripts/migrate.py --status   # 只列出狀態

檔名規則：NNN_說明.sql；檔名含 `.postgis.` 的只在資料庫有 PostGIS 時套用。
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url  # noqa: E402

MIGRATIONS = ROOT / "migrations"


def has_postgis(conn: psycopg.Connection) -> bool:
    return conn.execute("SELECT 1 FROM pg_extension WHERE extname='postgis'").fetchone() is not None


def main() -> int:
    status_only = "--status" in sys.argv
    with psycopg.connect(database_url()) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
                            version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())""")
        conn.commit()
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        postgis = has_postgis(conn)
        for f in sorted(MIGRATIONS.glob("*.sql")):
            name = f.stem
            if name in done:
                print(f"  已套用  {f.name}")
                continue
            if ".postgis" in f.name and not postgis:
                print(f"  略過    {f.name}（沒有 PostGIS）")
                continue
            if status_only:
                print(f"  未套用  {f.name}")
                continue
            with conn.transaction():
                conn.execute(f.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (name,))
            print(f"  套用    {f.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

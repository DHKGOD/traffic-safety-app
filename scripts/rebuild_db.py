"""一鍵重建資料庫：（local 模式先啟動資料庫）→ 建帳號 → migration → 匯入 → 危險路口 → 筆數報告。

    uv run python scripts/rebuild_db.py              # 保留使用者回報與模型紀錄
    uv run python scripts/rebuild_db.py --reset      # 連資料表一起刪掉重建（使用者回報也會清空！）
    uv run python scripts/rebuild_db.py --download   # 先下載最新原始資料
    uv run python scripts/rebuild_db.py --skip-bootstrap  # 沒有超級使用者權限的主機

換主機時：設定好 .env 後執行這一支即可。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url, env  # noqa: E402

DROP = """DROP TABLE IF EXISTS prediction, model_version, user_report, party, accident, hotspot,
          collision_type, cause_code, import_batch, schema_migrations CASCADE"""


def step(script: str, *args: str) -> None:
    print(f"\n=== {script} {' '.join(args)} ===", flush=True)
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / script), *args], cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"{script} 失敗（代碼 {r.returncode}）")


def main() -> int:
    argv = sys.argv[1:]
    if "--download" in argv:
        step("download_data.py")
    if env("DB_MODE", "local") == "local":
        step("localdb.py", "start")
    if "--skip-bootstrap" not in argv:
        step("setup_env.py")
        step("db_bootstrap.py")
    if "--reset" in argv:
        print("\n=== 刪除所有資料表（--reset）===")
        with psycopg.connect(database_url()) as conn:
            conn.execute(DROP)
    step("migrate.py")
    step("import_accidents.py")
    step("build_hotspots.py")
    step("db_report.py")
    print("\n資料庫重建完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

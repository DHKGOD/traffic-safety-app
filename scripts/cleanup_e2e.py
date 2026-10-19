"""刪除端對端測試產生的使用者回報（描述以「E2E 自動測試」開頭，或裝置代碼為 e2e-*）。"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import database_url  # noqa: E402

with psycopg.connect(database_url()) as conn:
    n = conn.execute("""DELETE FROM user_report
                        WHERE description LIKE 'E2E 自動測試%%' OR device_id LIKE 'e2e-%%'""").rowcount
    print(f"已清除 {n} 筆 E2E 測試回報")

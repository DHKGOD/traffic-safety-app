"""刪除端對端測試產生的資料：使用者回報（描述以「E2E 自動測試」開頭或裝置代碼 e2e-*）、測試時分享的路線。"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import database_url  # noqa: E402

with psycopg.connect(database_url()) as conn:
    n = conn.execute("""DELETE FROM user_report
                        WHERE description LIKE 'E2E 自動測試%%' OR device_id LIKE 'e2e-%%'""").rowcount
    # E2E 分享的是 Demo 路線（輔仁大學 → 捷運新莊站），且建立於最近 1 小時
    r = conn.execute("""DELETE FROM shared_route
                        WHERE start_name = '輔仁大學' AND end_name = '捷運新莊站'
                          AND created_at > now() - interval '1 hour'""").rowcount
    print(f"已清除 E2E 測試回報 {n} 筆、分享路線 {r} 筆")

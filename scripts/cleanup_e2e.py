"""刪除端對端測試產生的資料：
- 使用者回報：描述以「E2E 自動測試」開頭，或裝置代碼為 e2e-*
- 分享路線：只刪 E2E 測試記錄在 frontend/test-results/e2e-codes.txt 的代碼（不會誤刪真實分享）
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url  # noqa: E402

CODES = ROOT / "frontend" / "test-results" / "e2e-codes.txt"

codes = [c.strip() for c in CODES.read_text(encoding="utf-8").split()] if CODES.exists() else []
with psycopg.connect(database_url()) as conn:
    n = conn.execute("""DELETE FROM user_report
                        WHERE description LIKE 'E2E 自動測試%%' OR device_id LIKE 'e2e-%%'""").rowcount
    r = conn.execute("DELETE FROM shared_route WHERE code = ANY(%s)", (codes,)).rowcount if codes else 0
CODES.unlink(missing_ok=True)
print(f"已清除 E2E 測試回報 {n} 筆、分享路線 {r} 筆")

"""用 SQL 查各資料表筆數，印出並寫入 docs/db-report.md。

    uv run python scripts/db_report.py
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url  # noqa: E402

TABLES = [
    ("accident", "事故（一件事故一列）"),
    ("party", "當事人（原始 CSV 每一列）"),
    ("hotspot", "危險路口（格網彙整）"),
    ("cause_code", "肇因代碼"),
    ("collision_type", "事故類型及型態代碼"),
    ("import_batch", "匯入批次（原始檔）"),
    ("user_report", "使用者回報"),
    ("model_version", "AI 模型版本"),
    ("prediction", "AI 預測紀錄"),
    ("shared_route", "家人分享路線"),
]

QUERIES = {
    "事故件數": "SELECT count(*) FROM accident",
    "當事人列數": "SELECT count(*) FROM party",
    "當事者順位=1 的列數（應等於事故件數）": "SELECT count(*) FROM party WHERE party_order = 1",
    "座標有效的事故": "SELECT count(*) FROM accident WHERE coord_valid",
    "已對應到危險路口的事故": "SELECT count(*) FROM accident WHERE hotspot_id IS NOT NULL",
    "115 年 1–8 月事故件數": "SELECT count(*) FROM accident WHERE year = 2026 AND month <= 8",
    "115 年 1–8 月當事人列數": "SELECT count(*) FROM party p JOIN accident a ON a.id = p.accident_id WHERE a.year = 2026 AND a.month <= 8",
}


def main() -> int:
    lines = [f"# 資料庫筆數報告", "", f"產生時間：{datetime.now():%Y-%m-%d %H:%M}（`uv run python scripts/db_report.py` 自動產生）", ""]
    with psycopg.connect(database_url()) as conn:
        pg = conn.execute("SHOW server_version").fetchone()[0]
        postgis = conn.execute("SELECT extversion FROM pg_extension WHERE extname='postgis'").fetchone()
        lines += [f"- PostgreSQL {pg}；PostGIS {postgis[0] if postgis else '未安裝（使用替代查詢）'}", ""]
        lines += ["## 各資料表筆數", "", "| 資料表 | 說明 | 筆數 |", "|---|---|---:|"]
        for t, desc in TABLES:
            n = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
            lines.append(f"| `{t}` | {desc} | {n:,} |")
        lines += ["", "## 重點查詢", "", "| 項目 | SQL | 結果 |", "|---|---|---:|"]
        for k, q in QUERIES.items():
            n = conn.execute(q).fetchone()[0]
            lines.append(f"| {k} | `{q}` | {n:,} |")
        lines += ["", "## 各月份（依原始檔）", "", "| 原始檔 | 事故件數 | 當事人列數 |", "|---|---:|---:|"]
        for f, a, p in conn.execute("SELECT source_file, accident_rows, party_rows FROM import_batch ORDER BY id"):
            lines.append(f"| {Path(f).name} | {a:,} | {p:,} |")
        tot = conn.execute("SELECT sum(accident_rows), sum(party_rows) FROM import_batch").fetchone()
        lines.append(f"| **合計** | **{(tot[0] or 0):,}** | **{(tot[1] or 0):,}** |")
    text = "\n".join(lines) + "\n"
    out = ROOT / "docs" / "db-report.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

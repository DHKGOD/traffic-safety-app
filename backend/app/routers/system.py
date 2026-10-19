"""健康檢查與後台統計（資料筆數、資料表關係）。"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter

from ..config import DATA_SOURCE, DISCLAIMER
from ..db import db

router = APIRouter(prefix="/api", tags=["系統"])

TABLES = [
    ("accident", "事故"), ("party", "當事人"), ("hotspot", "危險路口"), ("cause_code", "肇因代碼"),
    ("collision_type", "事故型態代碼"), ("import_batch", "匯入批次"), ("user_report", "使用者回報"),
    ("model_version", "AI 模型版本"), ("prediction", "AI 預測紀錄"),
]


@router.get("/health", summary="健康檢查")
def health() -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        with db.conn() as c:
            c.execute("SELECT 1").fetchone()
            ver = c.execute("SHOW server_version").fetchone()["server_version"]
        ok, err = True, None
    except Exception as e:  # noqa: BLE001 — 健康檢查要回報任何錯誤
        ok, err, ver = False, str(e), None
    return {"status": "ok" if ok else "error", "database": {"ok": ok, "version": ver, "error": err,
            "postgis": db.postgis, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)},
            "server_time": datetime.now().isoformat(timespec="seconds"), "api_version": "0.1.0"}


@router.get("/meta", summary="App 顯示用的說明文字")
def meta() -> dict[str, Any]:
    return {"disclaimer": DISCLAIMER, "data_source": DATA_SOURCE}


@router.get("/admin/stats", summary="後台：各資料表筆數與關係")
def stats() -> dict[str, Any]:
    with db.conn() as c:
        counts = []
        for t, label in TABLES:
            n = c.execute(f"SELECT count(*) AS n FROM {t}").fetchone()["n"]
            counts.append({"table": t, "label": label, "rows": n})
        rels = c.execute("""
            SELECT tc.table_name AS child, kcu.column_name AS column, ccu.table_name AS parent
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY child, kcu.column_name""").fetchall()
        months = c.execute("""SELECT year, month, count(*) AS n FROM accident GROUP BY year, month
                              ORDER BY year, month""").fetchall()
    return {"tables": counts, "relations": rels,
            "monthly": [{"label": f"{m['year'] - 1911}/{m['month']:02d}", "n": m["n"]} for m in months],
            "postgis": db.postgis, "data_source": DATA_SOURCE}

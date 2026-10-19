"""使用者回報「差點被撞」：新增後存入資料庫，其他裝置用 since_id 輪詢即時看到。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..db import db, haversine_sql

router = APIRouter(prefix="/api/reports", tags=["使用者回報"])

CATEGORY_LABEL = {"near_miss": "差點被撞", "hazard": "路況危險", "other": "其他"}


class ReportIn(BaseModel):
    lat: float = Field(..., ge=21.5, le=26.8, description="緯度（台灣範圍）")
    lon: float = Field(..., ge=117.5, le=122.5, description="經度（台灣範圍）")
    category: Literal["near_miss", "hazard", "other"] = "near_miss"
    description: str | None = Field(None, max_length=500)
    device_id: str | None = Field(None, max_length=64)


class ReportOut(BaseModel):
    id: int
    created_at: datetime
    lat: float
    lon: float
    category: str
    category_label: str
    description: str | None
    hotspot_id: int | None
    hotspot_name: str | None = None


SELECT = """SELECT r.id, r.created_at, r.lat, r.lon, r.category, r.description, r.hotspot_id,
                   h.name AS hotspot_name
            FROM user_report r LEFT JOIN hotspot h ON h.id = r.hotspot_id"""


def _out(r: dict[str, Any]) -> dict[str, Any]:
    r["category_label"] = CATEGORY_LABEL.get(r["category"], r["category"])
    return r


@router.post("", response_model=ReportOut, status_code=201, summary="新增回報")
def create(rep: ReportIn) -> dict[str, Any]:
    p = {"lat": rep.lat, "lon": rep.lon}
    with db.conn() as c:
        # 對應到 100 公尺內最近的危險路口（沒有就留空）
        if db.postgis:
            near = c.execute("""SELECT id FROM hotspot
                                WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, 100)
                                ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
                                LIMIT 1""", p).fetchone()
        else:
            d = haversine_sql("lat", "lon")
            near = c.execute(f"""SELECT id FROM hotspot
                                 WHERE lat BETWEEN %(lat)s - 0.001 AND %(lat)s + 0.001
                                   AND lon BETWEEN %(lon)s - 0.0012 AND %(lon)s + 0.0012 AND {d} <= 100
                                 ORDER BY {d} LIMIT 1""", p).fetchone()
        new_id = c.execute("""INSERT INTO user_report (lat, lon, category, description, device_id, hotspot_id)
                              VALUES (%(lat)s, %(lon)s, %(category)s, %(description)s, %(device_id)s, %(hotspot_id)s)
                              RETURNING id""",
                           {**rep.model_dump(), "hotspot_id": near["id"] if near else None}).fetchone()["id"]
        row = c.execute(SELECT + " WHERE r.id = %(id)s", {"id": new_id}).fetchone()
    return _out(row)


@router.get("", response_model=list[ReportOut], summary="列出回報（since_id 用於輪詢新回報）")
def list_reports(since_id: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)) -> list[dict[str, Any]]:
    with db.conn() as c:
        if since_id:
            rows = c.execute(SELECT + " WHERE r.id > %(s)s ORDER BY r.id ASC LIMIT %(n)s",
                             {"s": since_id, "n": limit}).fetchall()
        else:
            rows = c.execute(SELECT + " ORDER BY r.id DESC LIMIT %(n)s", {"n": limit}).fetchall()
    return [_out(r) for r in rows]

"""家人模式：分享路線。子女規劃好路線後產生 6 碼代碼，長輩手機輸入代碼即可下載（存在資料庫，30 天有效）。"""
from __future__ import annotations

import secrets
import threading
import time
from collections import defaultdict
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from psycopg import errors
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import db

router = APIRouter(prefix="/api/routes", tags=["家人模式"])

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉 0/O、1/I 等容易看錯的字


class RouteIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    mode: Literal["foot", "bike", "car"] = "foot"
    start_name: str = Field(..., max_length=80)
    end_name: str = Field(..., max_length=80)
    points: list[tuple[float, float]] = Field(..., min_length=2, max_length=2000)
    distance_m: int | None = Field(None, ge=0)
    duration_s: int | None = Field(None, ge=0)
    for_elder: bool = True


class RouteOut(BaseModel):
    code: str
    name: str
    mode: str
    start_name: str
    end_name: str
    points: list[list[float]]
    distance_m: int | None
    duration_s: int | None
    for_elder: bool
    created_at: datetime
    expires_at: datetime


def _valid_points(points: list[tuple[float, float]]) -> None:
    for lat, lon in points:
        if not (21.5 <= lat <= 26.8 and 117.5 <= lon <= 122.5):
            raise HTTPException(422, "路線座標不在台灣範圍內")


@router.post("", response_model=RouteOut, status_code=201, summary="分享路線（產生代碼）")
def share(route: RouteIn) -> dict[str, Any]:
    _valid_points(route.points)
    with db.conn() as c:
        for _ in range(8):  # 代碼碰撞時重試
            code = "".join(secrets.choice(ALPHABET) for _ in range(6))
            try:
                with c.transaction():
                    row = c.execute("""
                        INSERT INTO shared_route (code, name, mode, start_name, end_name, points, distance_m, duration_s, for_elder)
                        VALUES (%(code)s, %(name)s, %(mode)s, %(start_name)s, %(end_name)s, %(points)s, %(distance_m)s,
                                %(duration_s)s, %(for_elder)s)
                        RETURNING code, name, mode, start_name, end_name, points, distance_m, duration_s, for_elder,
                                  created_at, expires_at""",
                        {**route.model_dump(), "code": code, "points": Jsonb([list(p) for p in route.points])}).fetchone()
                return row
            except errors.UniqueViolation:
                continue
    raise HTTPException(500, "無法產生代碼，請再試一次")


MAX_FAILS = 10          # 同一個來源在 WINDOW 秒內最多猜錯幾次
WINDOW = 600
_fails: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()


def _check_throttle(ip: str) -> None:
    """防止暴力猜代碼（Codex 審查）：猜錯太多次就暫時拒絕。"""
    now = time.monotonic()
    with _lock:
        recent = [t for t in _fails[ip] if now - t < WINDOW]
        _fails[ip] = recent
        if len(recent) >= MAX_FAILS:
            raise HTTPException(429, "嘗試太多次，請 10 分鐘後再試")


def _record_fail(ip: str) -> None:
    with _lock:
        _fails[ip].append(time.monotonic())


@router.get("/{code}", response_model=RouteOut, summary="用代碼下載家人分享的路線")
def fetch(code: str, request: Request) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    _check_throttle(ip)
    code = code.strip().upper()
    if len(code) != 6 or set(code) - set(ALPHABET):
        _record_fail(ip)
        raise HTTPException(404, "找不到這個代碼（可能打錯或已超過 30 天）")
    with db.conn() as c:
        row = c.execute("""
            UPDATE shared_route SET fetch_count = fetch_count + 1
            WHERE code = %(code)s AND expires_at > now()
            RETURNING code, name, mode, start_name, end_name, points, distance_m, duration_s, for_elder,
                      created_at, expires_at""", {"code": code}).fetchone()
    if not row:
        _record_fail(ip)
        raise HTTPException(404, "找不到這個代碼（可能打錯或已超過 30 天）")
    return row

"""地名搜尋與路線規劃（後端代查 OpenStreetMap 服務，App 不直接連外部服務）。

- 地名搜尋：Nominatim（OSM 官方），依使用政策：可識別的 User-Agent、每秒最多 1 次、結果快取。
- 路線：FOSSGIS 的 OSRM（routing.openstreetmap.de），支援步行／自行車／汽車。
"""
from __future__ import annotations

import math
import threading
import time
from functools import lru_cache
from typing import Any, Literal

import httpx
import truststore
from fastapi import APIRouter, HTTPException, Query

truststore.inject_into_ssl()  # 使用作業系統憑證庫（部分防毒軟體會攔截 TLS）

router = APIRouter(prefix="/api/geo", tags=["地名與路線"])

UA = "TrafficSafetyApp/0.1 (university database course project; https://github.com)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSRM = {"foot": "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
        "bike": "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
        "car": "https://routing.openstreetmap.de/routed-car/route/v1/driving"}
MAX_POINTS = 1800

_lock = threading.Lock()
_last_call = 0.0


def _throttle() -> None:
    """Nominatim 使用政策：每秒最多 1 次請求。"""
    global _last_call
    with _lock:
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()


@lru_cache(maxsize=512)
def _search(q: str, lat: float | None, lon: float | None) -> tuple[dict[str, Any], ...]:
    params: dict[str, Any] = {"q": q, "format": "jsonv2", "countrycodes": "tw", "limit": 8,
                              "accept-language": "zh-TW", "addressdetails": 1}
    if lat is not None and lon is not None:  # 偏好目前位置附近的結果
        params["viewbox"] = f"{lon - 0.5},{lat + 0.5},{lon + 0.5},{lat - 0.5}"
    _throttle()
    r = httpx.get(NOMINATIM, params=params, headers={"User-Agent": UA}, timeout=15)
    r.raise_for_status()
    out = []
    for p in r.json():
        a = p.get("address", {})
        area = "".join(x for x in (a.get("city") or a.get("county") or a.get("state"),
                                   a.get("suburb") or a.get("city_district") or a.get("town")) if x)
        out.append({"name": p.get("name") or p["display_name"].split(",")[0], "area": area,
                    "address": p["display_name"], "lat": float(p["lat"]), "lon": float(p["lon"]),
                    "kind": p.get("type")})
    return tuple(out)


@router.get("/search", summary="搜尋地名（台灣）")
def search(q: str = Query(..., min_length=1, max_length=100), lat: float | None = None,
           lon: float | None = None) -> list[dict[str, Any]]:
    try:
        return list(_search(q.strip(), round(lat, 2) if lat else None, round(lon, 2) if lon else None))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"地名搜尋服務暫時無法使用：{e.__class__.__name__}") from e


def _simplify(pts: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    """Douglas–Peucker 簡化折線（公尺），長路線點數太多時使用。"""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(pts[0][0])
    xy = [(math.radians(lo) * 6371000 * math.cos(lat0), math.radians(la) * 6371000) for la, lo in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        (x1, y1), (x2, y2) = xy[s], xy[e]
        dx, dy = x2 - x1, y2 - y1
        seg = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, -1
        for i in range(s + 1, e):
            d = abs(dy * (xy[i][0] - x1) - dx * (xy[i][1] - y1)) / seg
            if d > best:
                best, idx = d, i
        if best > tol_m and idx > 0:
            keep[idx] = True
            stack += [(s, idx), (idx, e)]
    return [p for p, k in zip(pts, keep) if k]


@lru_cache(maxsize=256)
def _route(a: tuple[float, float], b: tuple[float, float], mode: str) -> dict[str, Any]:
    url = f"{OSRM[mode]}/{a[1]},{a[0]};{b[1]},{b[0]}"
    r = httpx.get(url, params={"overview": "full", "geometries": "geojson"}, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(404, "找不到路線")
    route = data["routes"][0]
    pts = [(round(lat, 6), round(lon, 6)) for lon, lat in route["geometry"]["coordinates"]]
    tol = 2.0
    while len(pts) > MAX_POINTS:
        pts = _simplify(pts, tol)
        tol *= 2
    return {"distance_m": round(route["distance"]), "duration_s": round(route["duration"]), "points": pts}


@router.get("/route", summary="計算路線（步行／自行車／汽車）")
def route(from_: str = Query(..., alias="from", description="起點 lat,lon"),
          to: str = Query(..., description="終點 lat,lon"),
          mode: Literal["foot", "bike", "car"] = "foot") -> dict[str, Any]:
    try:
        a = tuple(round(float(x), 5) for x in from_.split(","))
        b = tuple(round(float(x), 5) for x in to.split(","))
        assert len(a) == 2 and len(b) == 2
    except (ValueError, AssertionError) as e:
        raise HTTPException(422, "座標格式應為 lat,lon") from e
    try:
        res = _route(a, b, mode)  # type: ignore[arg-type]
    except httpx.HTTPError as e:
        raise HTTPException(502, f"路線服務暫時無法使用：{e.__class__.__name__}") from e
    return {**res, "mode": mode, "points": [list(p) for p in res["points"]]}

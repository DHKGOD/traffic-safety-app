"""簡單幾何計算（路線距離），不依賴 PostGIS，小範圍用等距投影已足夠精確。"""
from __future__ import annotations

import math

EARTH_R = 6371000.0


def project(lat: float, lon: float, lat0: float) -> tuple[float, float]:
    """經緯度 → 以公尺為單位的平面座標（等距圓柱投影）。"""
    x = math.radians(lon) * EARTH_R * math.cos(math.radians(lat0))
    y = math.radians(lat) * EARTH_R
    return x, y


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def locate_on_route(route: list[tuple[float, float]], lat: float, lon: float) -> tuple[float, float]:
    """回傳 (點到路線的最短距離 m, 沿路線從起點算起的距離 m)。route 為 [(lat, lon), ...]。"""
    lat0 = route[0][0]
    pts = [project(a, b, lat0) for a, b in route]
    px, py = project(lat, lon, lat0)
    best_d, best_along, acc = math.inf, 0.0, 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        seg = math.hypot(dx, dy)
        t = 0.0 if seg == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (seg * seg)))
        d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
        if d < best_d:
            best_d, best_along = d, acc + t * seg
        acc += seg
    return best_d, best_along


def route_length(route: list[tuple[float, float]]) -> float:
    return sum(haversine(a[0], a[1], b[0], b[1]) for a, b in zip(route, route[1:]))

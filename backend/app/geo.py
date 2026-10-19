"""簡單幾何計算（路線距離），不依賴 PostGIS，小範圍用等距投影已足夠精確。"""
from __future__ import annotations

import math
from collections import defaultdict

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


class RouteIndex:
    """路線的空間索引：把每一段路放進格網，查詢點只需比對附近的路段（長路線也很快）。"""

    def __init__(self, route: list[tuple[float, float]], cell_m: float = 250.0):
        self.lat0 = sum(p[0] for p in route) / len(route)
        self.pts = [project(a, b, self.lat0) for a, b in route]
        self.cum = [0.0]
        for (x1, y1), (x2, y2) in zip(self.pts, self.pts[1:]):
            self.cum.append(self.cum[-1] + math.hypot(x2 - x1, y2 - y1))
        self.cell = cell_m
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, ((x1, y1), (x2, y2)) in enumerate(zip(self.pts, self.pts[1:])):
            for cx in range(int(min(x1, x2) // cell_m), int(max(x1, x2) // cell_m) + 1):
                for cy in range(int(min(y1, y2) // cell_m), int(max(y1, y2) // cell_m) + 1):
                    self.grid[(cx, cy)].append(i)

    @property
    def length(self) -> float:
        return self.cum[-1]

    def locate(self, lat: float, lon: float, max_d: float) -> tuple[float, float] | None:
        """回傳 (點到路線最短距離 m, 沿路線從起點算起的距離 m)；超過 max_d 回傳 None。"""
        px, py = project(lat, lon, self.lat0)
        r = int(max_d // self.cell) + 1
        cx, cy = int(px // self.cell), int(py // self.cell)
        segs = {i for dx in range(-r, r + 1) for dy in range(-r, r + 1) for i in self.grid.get((cx + dx, cy + dy), ())}
        best: tuple[float, float] | None = None
        for i in segs:
            (x1, y1), (x2, y2) = self.pts[i], self.pts[i + 1]
            dx, dy = x2 - x1, y2 - y1
            seg2 = dx * dx + dy * dy
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg2))
            d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d <= max_d and (best is None or d < best[0]):
                best = (d, self.cum[i] + t * math.sqrt(seg2))
        return best


def locate_on_route(route: list[tuple[float, float]], lat: float, lon: float) -> tuple[float, float]:
    """回傳 (點到路線的最短距離 m, 沿路線距離 m)。單點查詢用；大量查詢請用 RouteIndex。"""
    hit = RouteIndex(route).locate(lat, lon, 1e9)
    assert hit is not None
    return hit


def route_length(route: list[tuple[float, float]]) -> float:
    return sum(haversine(a[0], a[1], b[0], b[1]) for a, b in zip(route, route[1:]))

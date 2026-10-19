"""不需要資料庫的單元測試。"""
from __future__ import annotations

import math
import random

from backend.app.geo import RouteIndex, haversine, project
from scripts.build_hotspots import clean_name


def brute(route, lat, lon):
    lat0 = sum(p[0] for p in route) / len(route)
    pts = [project(a, b, lat0) for a, b in route]
    px, py = project(lat, lon, lat0)
    best, acc, along = math.inf, 0.0, 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        seg = math.hypot(dx, dy)
        t = 0 if seg == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / seg**2))
        d = math.hypot(px - x1 - t * dx, py - y1 - t * dy)
        if d < best:
            best, along = d, acc + t * seg
        acc += seg
    return best, along


def test_route_index_matches_brute_force():
    rnd = random.Random(1)
    lat, lon = 25.0, 121.4
    route = [(lat, lon)]
    for _ in range(400):  # 約 40 公里的隨機折線
        lat += rnd.uniform(-0.0008, 0.0012)
        lon += rnd.uniform(-0.0008, 0.0012)
        route.append((lat, lon))
    idx = RouteIndex(route)
    for _ in range(500):
        p = (rnd.uniform(25.0, lat), rnd.uniform(121.4, lon))
        d, along = brute(route, *p)
        hit = idx.locate(*p, 150)
        if d <= 150:
            assert hit is not None
            assert abs(hit[0] - d) < 0.01 and abs(hit[1] - along) < 0.5
        else:
            assert hit is None


def test_haversine_known_distance():
    # 台北車站 → 苗栗車站 直線約 89 公里
    assert 85_000 < haversine(25.0478, 121.5170, 24.5701, 120.8228) < 93_000


def test_merge_cells_joins_split_intersection_without_chaining():
    from scripts.build_hotspots import merge_cells

    def cell(n, lat, lon):
        return {"n": n, "lat": lat, "lon": lon}

    m = 1 / 111_000
    cells = {
        (0, 0): cell(17, 25.0, 121.0),                  # 主要格子
        (1, 0): cell(4, 25.0, 121.0 + 25 * m),          # 25 m 外的相鄰格子 → 合併
        (2, 0): cell(3, 25.0, 121.0 + 60 * m),          # 離主格 60 m（離第二格 35 m）→ 不連鎖合併
        (0, 5): cell(5, 25.0 + 200 * m, 121.0),         # 不相鄰 → 獨立
    }
    groups = {tuple(sorted(g)) for g in merge_cells(cells, 35)}
    assert ((0, 0), (1, 0)) in groups
    assert ((2, 0),) in groups and ((0, 5),) in groups


def test_clean_name():
    assert clean_name("新北市新莊區中正路 / 新北市新莊區民安路") == "中正路 / 民安路"
    assert clean_name("新北市新莊區中正路 / 新北市新莊區中正路") == "中正路"
    assert clean_name("桃園市中壢區中華路一段口 / 桃園市中壢區自強一路口") == "中華路一段 / 自強一路"
    assert clean_name("臺南市新市區中山路前0.0公尺") == "中山路"

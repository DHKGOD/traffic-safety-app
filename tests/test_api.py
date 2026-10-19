"""API 整合測試（需要資料庫已啟動並匯入資料：start_server.bat 或 scripts/rebuild_db.py）。

    uv run pytest
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.db import db
from backend.app.main import app

FJU = (25.0363, 121.4318)          # 輔仁大學
XINZHUANG = (25.0361, 121.4525)    # 捷運新莊站


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok"
    assert r["database"]["ok"] is True


def test_admin_counts_over_200k(client):
    tables = {t["table"]: t["rows"] for t in client.get("/api/admin/stats").json()["tables"]}
    assert tables["party"] >= 200_000
    assert tables["accident"] >= 200_000
    assert tables["hotspot"] > 0


def test_near_returns_sorted_hotspots(client):
    r = client.get("/api/hotspots/near", params={"lat": FJU[0], "lon": FJU[1], "radius": 1000}).json()
    assert r["count"] > 0
    counts = [h["filtered_count"] for h in r["hotspots"]]
    assert counts == sorted(counts, reverse=True)
    assert all(h["distance_m"] <= 1000 for h in r["hotspots"])
    assert r["disclaimer"]


def test_near_fallback_matches_postgis(client):
    """沒有 PostGIS 的替代查詢（haversine）要和 PostGIS 結果一致。"""
    if not db.postgis:
        pytest.skip("此資料庫沒有 PostGIS")
    params = {"lat": FJU[0], "lon": FJU[1], "radius": 1500, "limit": 200}
    a = client.get("/api/hotspots/near", params=params).json()
    db.postgis = False
    try:
        b = client.get("/api/hotspots/near", params=params).json()
    finally:
        db.postgis = True
    assert b["spatial_engine"] == "sql-haversine"
    assert {h["id"] for h in a["hotspots"]} == {h["id"] for h in b["hotspots"]}
    da = {h["id"]: h["distance_m"] for h in a["hotspots"]}
    for h in b["hotspots"]:
        # 球面公式與 PostGIS 橢球距離約差 0.3–0.5%，屬預期誤差
        assert abs(h["distance_m"] - da[h["id"]]) <= max(3, 0.006 * da[h["id"]])


def test_weather_filter_reduces_counts(client):
    params = {"lat": FJU[0], "lon": FJU[1], "radius": 2000, "limit": 200}
    allw = {h["id"]: h["filtered_count"] for h in client.get("/api/hotspots/near", params=params).json()["hotspots"]}
    rain = client.get("/api/hotspots/near", params={**params, "weather": "rain"}).json()["hotspots"]
    for h in rain:
        assert h["filtered_count"] <= allw.get(h["id"], h["accident_count"])


def test_route_hotspots_ordered_along_route(client):
    r = client.post("/api/hotspots/route", json={"points": [FJU, XINZHUANG], "buffer_m": 150}).json()
    assert r["route_length_m"] > 1500
    along = [h["along_m"] for h in r["hotspots"]]
    assert along == sorted(along)
    assert all(h["distance_to_route_m"] <= 150 for h in r["hotspots"])


def test_report(client):
    hid = client.get("/api/hotspots/top", params={"limit": 1}).json()["hotspots"][0]["id"]
    rep = client.get(f"/api/hotspots/{hid}/report").json()
    assert len(rep["hourly"]) == 24
    assert sum(rep["hourly"]) == rep["summary"]["accidents"]
    assert rep["advice"]["road_user"]
    assert client.get("/api/hotspots/99999999/report").status_code == 404


def test_create_and_poll_report(client):
    before = client.get("/api/reports", params={"limit": 1}).json()
    since = before[0]["id"] if before else 0
    r = client.post("/api/reports", json={"lat": FJU[0], "lon": FJU[1] + 0.001, "category": "near_miss",
                                          "description": "pytest 測試回報", "device_id": "pytest"})
    assert r.status_code == 201
    new = r.json()
    polled = client.get("/api/reports", params={"since_id": since}).json()
    assert any(p["id"] == new["id"] for p in polled)
    with db.conn() as c:  # 清掉測試資料
        c.execute("DELETE FROM user_report WHERE device_id = 'pytest'")


def test_share_route_roundtrip(client):
    body = {"name": "pytest 阿嬤買菜", "mode": "foot", "start_name": "家", "end_name": "市場",
            "points": [FJU, XINZHUANG], "distance_m": 2174, "duration_s": 1753, "for_elder": True}
    r = client.post("/api/routes", json=body)
    assert r.status_code == 201
    code = r.json()["code"]
    assert len(code) == 6 and not set(code) & set("01OI")
    got = client.get(f"/api/routes/{code.lower()}").json()  # 大小寫不拘
    assert got["name"] == body["name"] and got["points"] == [list(FJU), list(XINZHUANG)]
    assert client.get("/api/routes/ZZZZZZ").status_code == 404
    assert client.post("/api/routes", json={**body, "points": [(0, 0), (1, 1)]}).status_code == 422
    with db.conn() as c:
        c.execute("DELETE FROM shared_route WHERE name LIKE 'pytest%%'")


def test_share_code_guessing_is_throttled(client):
    from backend.app.routers import routes

    routes._fails.clear()
    try:
        for _ in range(routes.MAX_FAILS):
            assert client.get("/api/routes/ZZZZZZ").status_code == 404
        assert client.get("/api/routes/ZZZZZZ").status_code == 429  # 猜錯太多次被擋
        assert client.get("/api/routes/abc").status_code == 429
    finally:
        routes._fails.clear()


def test_report_validation(client):
    assert client.post("/api/reports", json={"lat": 0, "lon": 0}).status_code == 422

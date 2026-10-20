"""API 整合測試（需要資料庫已啟動並匯入資料：start_server.bat 或 scripts/rebuild_db.py）。

    uv run pytest
"""
from __future__ import annotations

import sys
from pathlib import Path

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


@pytest.mark.parametrize("fallback", [False, True])
def test_near_complete_keeps_low_count_hotspots_in_dense_area(client, fallback):
    """守護與範圍預覽不能因全區前 200 名而遺漏眼前的低事故數路口。"""
    original = db.postgis
    if fallback:
        db.postgis = False
    try:
        params = {"lat": 25.0478, "lon": 121.5170, "radius": 3000, "limit": 200}
        limited = client.get("/api/hotspots/near", params=params).json()
        full = client.get("/api/hotspots/near", params={**params, "complete": True}).json()
        nearby = client.get("/api/hotspots/near", params={**params, "radius": 500}).json()
        assert limited["count"] == 200
        assert full["count"] > limited["count"]
        assert {h["id"] for h in nearby["hotspots"]} <= {h["id"] for h in full["hotspots"]}
        assert all(h["distance_m"] <= 3000 for h in full["hotspots"])
        assert client.get("/api/hotspots/near", params={**params, "radius": 5001, "complete": True}).status_code == 422
    finally:
        db.postgis = original


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


def test_areas_for_custom_ranking(client):
    """排行「自訂」地區選單：縣市依路口數排序，行政區加總要等於縣市總數，且能用來查排行。"""
    areas = client.get("/api/hotspots/areas").json()
    assert len(areas) >= 15
    assert [a["hotspots"] for a in areas] == sorted((a["hotspots"] for a in areas), reverse=True)
    for a in areas:
        assert sum(d["hotspots"] for d in a["districts"]) == a["hotspots"]
    ntp = next(a for a in areas if a["city"] == "新北市")
    assert any(d["district"] == "新莊區" for d in ntp["districts"])
    top = client.get("/api/hotspots/top", params={"city": "台北市", "district": "中正區", "limit": 5}).json()
    assert top["count"] > 0 and all(h["city"] == "臺北市" and h["district"] == "中正區" for h in top["hotspots"])


def test_report(client):
    hid = client.get("/api/hotspots/top", params={"limit": 1}).json()["hotspots"][0]["id"]
    rep = client.get(f"/api/hotspots/{hid}/report").json()
    assert len(rep["hourly"]) == 24
    assert sum(rep["hourly"]) == rep["summary"]["accidents"]
    assert rep["advice"]["road_user"]
    rr = rep["rain_risk"]  # 有跑過 ai/rain_risk.py 才有；沒有時為 None（前端退回天候欄判斷）
    if rr is not None:
        assert rr["level"] in ("rain_high", "rain_low", "normal")
        assert 0 <= rr["rainy_accidents"] <= rr["accidents"]
    assert client.get("/api/hotspots/99999999/report").status_code == 404


def test_rain_risk_stats():
    """AI 任務 2 的統計小工具：BH 多重檢定與 Poisson deviance。"""
    import numpy as np
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai"))
    import rain_risk as R
    assert R.parse_mm("T") == 0 and R.parse_mm("X") is None and R.parse_mm("") is None and R.parse_mm("12.5") == 12.5
    sig = R.bh(np.array([0.001, 0.02, 0.03, 0.5]), 0.05)
    assert sig.tolist() == [True, True, True, False]
    assert R.bh(np.array([0.2, 0.9]), 0.05).tolist() == [False, False]
    y = np.array([0, 1, 3])
    assert R.deviance(y, y.astype(float) + 1e-12) < 1e-6
    assert R.deviance(y, np.full(3, 1.0)) > 0


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


def test_weather_now(client, monkeypatch):
    """即時天氣：有授權碼時回傳最近測站與建議模式；沒有授權碼時 available=false。"""
    from backend.app.config import settings
    from backend.app.routers import weather

    r = client.get("/api/weather/now", params={"lat": FJU[0], "lon": FJU[1]})
    if settings.cwa_api_key:
        if r.status_code == 502:
            pytest.skip("氣象署服務暫時無法連線")
        d = r.json()
        assert d["available"] is True and d["suggested_mode"] in ("rain", "clear")
        assert d["station"]["county"] == "新北市" and d["station"]["distance_km"] < weather.MAX_STATION_KM
        assert d["forecast"] is None or 0 <= d["forecast"]["pop"] <= 100
    monkeypatch.setattr(weather, "settings", type("S", (), {"cwa_api_key": ""})())
    assert client.get("/api/weather/now", params={"lat": FJU[0], "lon": FJU[1]}).json() == {
        "available": False, "reason": "伺服器未設定氣象署授權碼"}
    assert client.get("/api/weather/now", params={"lat": 0, "lon": 0}).status_code == 422


def test_weather_decision(monkeypatch):
    """建議規則：雨量 ≥ 0.5 mm 或降雨機率 ≥ 60% → 雨天；負值（氣象署無資料代碼）不算下雨。"""
    from backend.app.routers import weather

    assert weather._num("-998") is None and weather._num("X") is None and weather._num("2.5") == 2.5
    # 沒有時區的時間字串視為台灣時間，可以和有時區的時間比較（Codex 審查）
    assert weather._ts("2026-10-20 06:00:00") == weather._ts("2026-10-20T06:00:00+08:00")
    st = {"name": "新莊", "id": "C0ACA0", "lat": 25.05, "lon": 121.44, "county": "新北市", "town": "新莊區",
          "obs_time": "t", "rain_1h": 0.0, "rain_3h": 0.0}
    monkeypatch.setattr(weather, "settings", type("S", (), {"cwa_api_key": "x"})())
    cases = [(0.0, 10, "clear"), (0.5, 0, "rain"), (0.0, 60, "rain"), (None, 20, "clear"), (None, None, "clear")]
    for rain, pop, want in cases:
        monkeypatch.setattr(weather, "_stations", lambda: [{**st, "rain_1h": rain}])
        monkeypatch.setattr(weather, "_forecast", lambda c, t: None if pop is None else {"pop": pop, "weather": "x"})
        assert weather.weather_now(25.0363, 121.4318)["suggested_mode"] == want, (rain, pop)
    # 最近測站太遠 → 不採用即時雨量
    monkeypatch.setattr(weather, "_stations", lambda: [{**st, "lat": 24.0, "rain_1h": 9.0}])
    monkeypatch.setattr(weather, "_forecast", lambda c, t: {"pop": 0, "weather": "晴"})
    d = weather.weather_now(25.0363, 121.4318)
    assert d["rain_1h_mm"] is None and d["suggested_mode"] == "clear"


def test_report_validation(client):
    assert client.post("/api/reports", json={"lat": 0, "lon": 0}).status_code == 422

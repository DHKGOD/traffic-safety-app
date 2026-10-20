"""即時天氣：中央氣象署開放資料（後端代查，授權碼只放伺服器 .env，App 不會拿到）。

- 即時雨量：O-A0002-001 自動雨量站（全台約 1,300 站、每 10 分鐘更新），取最近測站「過去 1 小時雨量」。
- 降雨機率：F-D0047-xxx 鄉鎮未來 3 天逐 3 小時預報（每個縣市一個資料集），取目前時段。
- 雨天模式建議：過去 1 小時雨量 ≥ 0.5 mm，或目前時段降雨機率 ≥ 60%。
"""
from __future__ import annotations

import math
import threading
import time
from datetime import datetime
from typing import Any

import httpx
import truststore
from fastapi import APIRouter, HTTPException, Query

from ..config import settings

truststore.inject_into_ssl()

router = APIRouter(prefix="/api/weather", tags=["天氣"])

BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
SOURCE = "中央氣象署開放資料（O-A0002-001 自動雨量站、F-D0047 鄉鎮天氣預報）"
RAIN_MM = 0.5          # 過去 1 小時雨量達此值視為下雨
POP_RAIN = 60          # 降雨機率達此值建議雨天模式
MAX_STATION_KM = 15    # 最近雨量站超過此距離就不採用即時雨量
OBS_TTL = 600          # 即時雨量快取 10 分鐘（氣象署每 10 分鐘更新）
FC_TTL = 1800          # 預報快取 30 分鐘

# 鄉鎮未來 3 天逐 3 小時預報：每個縣市一個資料集（2026-10-20 逐一呼叫確認）
FORECAST_DATASET = {
    "宜蘭縣": "001", "桃園市": "005", "新竹縣": "009", "苗栗縣": "013", "彰化縣": "017", "南投縣": "021",
    "雲林縣": "025", "嘉義縣": "029", "屏東縣": "033", "臺東縣": "037", "花蓮縣": "041", "澎湖縣": "045",
    "基隆市": "049", "新竹市": "053", "嘉義市": "057", "臺北市": "061", "高雄市": "065", "新北市": "069",
    "臺中市": "073", "臺南市": "077", "連江縣": "081", "金門縣": "085",
}

_lock = threading.Lock()
_cache: dict[Any, tuple[float, Any]] = {}


def _cached(key: Any, ttl: float, fn):
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
    return val


def _get(dataset: str, **params: str) -> dict[str, Any]:
    r = httpx.get(BASE + dataset, params={"Authorization": settings.cwa_api_key, "format": "JSON", **params},
                  timeout=20)
    if r.status_code in (401, 403):
        raise HTTPException(502, "氣象署授權碼無效，請檢查 .env 的 CWA_API_KEY")
    r.raise_for_status()
    data = r.json()
    if str(data.get("success")) != "true":
        raise HTTPException(502, "氣象署資料暫時無法取得")
    return data["records"]


def _num(v: Any) -> float | None:
    """氣象署以負值（如 -998、-999）表示無資料或儀器異常。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 and math.isfinite(f) else None


def _stations() -> list[dict[str, Any]]:
    def load() -> list[dict[str, Any]]:
        recs = _get("O-A0002-001", RainfallElement="Past1hr,Past3hr",
                    GeoInfo="Coordinates,CountyName,TownName")
        out = []
        for s in recs.get("Station", []):
            geo = s.get("GeoInfo", {})
            wgs = next((c for c in geo.get("Coordinates", []) if c.get("CoordinateName") == "WGS84"), None)
            if not wgs:
                continue
            rain = s.get("RainfallElement", {})
            out.append({"name": s.get("StationName"), "id": s.get("StationId"),
                        "lat": float(wgs["StationLatitude"]), "lon": float(wgs["StationLongitude"]),
                        "county": geo.get("CountyName"), "town": geo.get("TownName"),
                        "obs_time": (s.get("ObsTime") or {}).get("DateTime"),
                        "rain_1h": _num((rain.get("Past1hr") or {}).get("Precipitation")),
                        "rain_3h": _num((rain.get("Past3hr") or {}).get("Precipitation"))})
        return out
    return _cached("stations", OBS_TTL, load)


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _forecast(county: str, town: str) -> dict[str, Any] | None:
    ds = FORECAST_DATASET.get(county)
    if not ds:
        return None

    def load() -> list[dict[str, Any]]:
        recs = _get(f"F-D0047-{ds}", LocationName=town, ElementName="3小時降雨機率,天氣現象")
        locs = (recs.get("Locations") or [{}])[0].get("Location") or []
        if not locs:
            return []
        el = {e["ElementName"]: e["Time"] for e in locs[0].get("WeatherElement", [])}
        wx = {t["StartTime"]: t["ElementValue"][0].get("Weather") for t in el.get("天氣現象", [])}
        return [{"start": t["StartTime"], "end": t["EndTime"],
                 "pop": _num(t["ElementValue"][0].get("ProbabilityOfPrecipitation")),
                 "weather": wx.get(t["StartTime"])} for t in el.get("3小時降雨機率", [])]

    periods = _cached(("fc", ds, town), FC_TTL, load)
    now = datetime.now().astimezone()
    for i, p in enumerate(periods):
        if datetime.fromisoformat(p["end"]) > now:
            nxt = periods[i + 1] if i + 1 < len(periods) else None
            return {**p, "next": nxt}
    return None


@router.get("/now", summary="目前位置的即時雨量與降雨機率（建議晴天／雨天模式）")
def weather_now(lat: float = Query(..., ge=21.5, le=26.5), lon: float = Query(..., ge=118, le=122.5)) -> dict[str, Any]:
    if not settings.cwa_api_key:
        return {"available": False, "reason": "伺服器未設定氣象署授權碼"}
    try:
        stations = _stations()
        near = min(stations, key=lambda s: _km(lat, lon, s["lat"], s["lon"]), default=None)
        if near is None:
            raise HTTPException(502, "氣象署雨量資料暫時無法取得")
        dist = _km(lat, lon, near["lat"], near["lon"])
        fc = _forecast(near["county"], near["town"])
    except httpx.HTTPError as e:
        raise HTTPException(502, f"氣象署服務暫時無法使用：{e.__class__.__name__}") from e

    rain_1h = near["rain_1h"] if dist <= MAX_STATION_KM else None
    raining = rain_1h is not None and rain_1h >= RAIN_MM
    pop = fc["pop"] if fc else None
    if raining:
        mode, reason = "rain", f"附近測站過去 1 小時雨量 {rain_1h:g} mm"
    elif pop is not None and pop >= POP_RAIN:
        mode, reason = "rain", f"目前時段降雨機率 {pop:g}%"
    else:
        mode, reason = "clear", "附近沒有下雨" + (f"，降雨機率 {pop:g}%" if pop is not None else "")
    return {
        "available": True, "suggested_mode": mode, "reason": reason, "raining": raining,
        "rain_1h_mm": rain_1h, "pop_percent": pop,
        "station": {"name": near["name"], "id": near["id"], "county": near["county"], "town": near["town"],
                    "distance_km": round(dist, 1), "obs_time": near["obs_time"]},
        "forecast": fc, "thresholds": {"rain_mm": RAIN_MM, "pop_percent": POP_RAIN}, "source": SOURCE,
    }

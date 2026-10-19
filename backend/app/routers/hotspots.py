"""危險路口：附近查詢、路線查詢、排行、路口體檢報告。"""
from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..advice import build_advice
from ..config import DISCLAIMER
from ..db import db, haversine_sql
from ..filters import PERIOD_LABEL, WEATHER_LABEL, Period, Weather, accident_filter_sql
from ..geo import locate_on_route, route_length

router = APIRouter(prefix="/api/hotspots", tags=["危險路口"])

HOTSPOT_COLS = """h.id, h.name, h.city, h.district, h.lon, h.lat, h.accident_count, h.injury_count,
                  h.death_count, h.rain_count, h.night_count, h.risk_score"""


def _decorate(row: dict[str, Any]) -> dict[str, Any]:
    row["level"] = db.level(row["risk_score"])
    row["risk_score"] = round(row["risk_score"], 2)
    if "distance_m" in row and row["distance_m"] is not None:
        row["distance_m"] = round(float(row["distance_m"]), 1)
    return row


@router.get("/near", summary="查詢某座標附近的危險路口")
def near(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
         radius: int = Query(500, ge=50, le=5000, description="半徑（公尺）"),
         weather: Weather = Weather.all, period: Period = Period.all,
         limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    af = accident_filter_sql(weather, period)
    p = {"lat": lat, "lon": lon, "radius": radius, "limit": limit,
         "dlat": radius / 111000, "dlon": radius / (111000 * max(0.2, abs(math.cos(math.radians(lat)))))}
    if db.postgis:
        dist = "ST_Distance(h.geom, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography)"
        where = "ST_DWithin(h.geom, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(radius)s)"
    else:
        dist = haversine_sql("h.lat", "h.lon")
        where = (f"h.lat BETWEEN %(lat)s - %(dlat)s AND %(lat)s + %(dlat)s "
                 f"AND h.lon BETWEEN %(lon)s - %(dlon)s AND %(lon)s + %(dlon)s AND {dist} <= %(radius)s")
    sql = f"""SELECT {HOTSPOT_COLS}, {dist} AS distance_m, count(a.id) AS filtered_count
              FROM hotspot h JOIN accident a ON a.hotspot_id = h.id
              WHERE {where} {af}
              GROUP BY h.id
              ORDER BY filtered_count DESC, h.risk_score DESC
              LIMIT %(limit)s"""
    with db.conn() as c:
        rows = [_decorate(r) for r in c.execute(sql, p).fetchall()]
    return {"center": {"lat": lat, "lon": lon}, "radius_m": radius, "weather": weather, "period": period,
            "mode_label": f"{WEATHER_LABEL[weather]}・{PERIOD_LABEL[period]}", "spatial_engine":
            "postgis" if db.postgis else "sql-haversine", "count": len(rows), "hotspots": rows,
            "disclaimer": DISCLAIMER}


class RouteRequest(BaseModel):
    points: list[tuple[float, float]] = Field(..., min_length=2, max_length=2000,
                                              description="路線座標 [[lat, lon], ...]")
    buffer_m: int = Field(80, ge=10, le=500, description="離路線多近算「在路線上」")
    weather: Weather = Weather.all
    period: Period = Period.all
    min_accidents: int = Field(3, ge=1)


@router.post("/route", summary="查詢路線沿途的危險路口（依沿路距離排序）")
def route(req: RouteRequest) -> dict[str, Any]:
    lats = [p[0] for p in req.points]
    lons = [p[1] for p in req.points]
    pad_lat = req.buffer_m / 111000 + 0.0005
    pad_lon = pad_lat * 1.2
    af = accident_filter_sql(req.weather, req.period)
    sql = f"""SELECT {HOTSPOT_COLS}, count(a.id) AS filtered_count
              FROM hotspot h JOIN accident a ON a.hotspot_id = h.id
              WHERE h.lat BETWEEN %(lat1)s AND %(lat2)s AND h.lon BETWEEN %(lon1)s AND %(lon2)s {af}
              GROUP BY h.id HAVING count(a.id) >= %(minn)s"""
    with db.conn() as c:
        cand = c.execute(sql, {"lat1": min(lats) - pad_lat, "lat2": max(lats) + pad_lat,
                               "lon1": min(lons) - pad_lon, "lon2": max(lons) + pad_lon,
                               "minn": req.min_accidents}).fetchall()
    hits = []
    for r in cand:
        d, along = locate_on_route(req.points, r["lat"], r["lon"])
        if d <= req.buffer_m:
            r["distance_to_route_m"] = round(d, 1)
            r["along_m"] = round(along, 1)
            hits.append(_decorate(r))
    hits.sort(key=lambda r: r["along_m"])
    return {"route_length_m": round(route_length(req.points), 1), "buffer_m": req.buffer_m,
            "weather": req.weather, "period": req.period,
            "mode_label": f"{WEATHER_LABEL[req.weather]}・{PERIOD_LABEL[req.period]}",
            "count": len(hits), "hotspots": hits, "disclaimer": DISCLAIMER}


@router.get("/top", summary="危險路口排行")
def top(city: str | None = None, district: str | None = None, weather: Weather = Weather.all,
        period: Period = Period.all, limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    af = accident_filter_sql(weather, period)
    cond, p = [], {"limit": limit}
    if city:
        cond.append("h.city = %(city)s")
        p["city"] = city.replace("台", "臺")
    if district:
        cond.append("h.district = %(district)s")
        p["district"] = district
    where = " AND ".join(cond) or "TRUE"
    sql = f"""SELECT {HOTSPOT_COLS}, count(a.id) AS filtered_count
              FROM hotspot h JOIN accident a ON a.hotspot_id = h.id
              WHERE {where} {af}
              GROUP BY h.id ORDER BY filtered_count DESC, h.risk_score DESC LIMIT %(limit)s"""
    with db.conn() as c:
        rows = [_decorate(r) for r in c.execute(sql, p).fetchall()]
    return {"count": len(rows), "hotspots": rows, "disclaimer": DISCLAIMER}


def _dist(c, sql: str, hid: int) -> list[dict[str, Any]]:
    return c.execute(sql, {"id": hid}).fetchall()


@router.get("/{hotspot_id}/report", summary="路口體檢報告")
def report(hotspot_id: int) -> dict[str, Any]:
    with db.conn() as c:
        h = c.execute(f"SELECT {HOTSPOT_COLS} FROM hotspot h WHERE h.id = %(id)s", {"id": hotspot_id}).fetchone()
        if not h:
            raise HTTPException(404, "找不到這個路口")
        h = _decorate(h)
        hourly = {r["hour"]: r["n"] for r in _dist(
            c, "SELECT hour, count(*) AS n FROM accident WHERE hotspot_id=%(id)s GROUP BY hour", hotspot_id)}
        weekday = {r["weekday"]: r["n"] for r in _dist(
            c, "SELECT weekday, count(*) AS n FROM accident WHERE hotspot_id=%(id)s GROUP BY weekday", hotspot_id)}
        monthly = _dist(c, """SELECT year, month, count(*) AS n FROM accident WHERE hotspot_id=%(id)s
                               GROUP BY year, month ORDER BY year, month""", hotspot_id)
        weather = _dist(c, """SELECT coalesce(weather,'不明') AS name, count(*) AS n FROM accident
                               WHERE hotspot_id=%(id)s GROUP BY 1 ORDER BY n DESC""", hotspot_id)
        light = _dist(c, """SELECT coalesce(light,'不明') AS name, count(*) AS n FROM accident
                             WHERE hotspot_id=%(id)s GROUP BY 1 ORDER BY n DESC""", hotspot_id)
        causes = _dist(c, """SELECT cc.minor AS name, cc.major AS category, count(*) AS n
                              FROM accident a JOIN cause_code cc ON cc.id = a.main_cause_id
                              WHERE a.hotspot_id=%(id)s GROUP BY cc.id ORDER BY n DESC LIMIT 6""", hotspot_id)
        collisions = _dist(c, """SELECT ct.minor AS name, ct.major AS category, count(*) AS n
                                  FROM accident a JOIN collision_type ct ON ct.id = a.collision_type_id
                                  WHERE a.hotspot_id=%(id)s GROUP BY ct.id ORDER BY n DESC LIMIT 6""", hotspot_id)
        vehicles = _dist(c, """SELECT p.vehicle_major AS name, count(*) AS n FROM party p
                                JOIN accident a ON a.id = p.accident_id
                                WHERE a.hotspot_id=%(id)s AND p.vehicle_major IS NOT NULL
                                GROUP BY 1 ORDER BY n DESC LIMIT 6""", hotspot_id)
        ages = _dist(c, """SELECT CASE WHEN p.age < 18 THEN '未滿18' WHEN p.age < 25 THEN '18–24'
                                       WHEN p.age < 45 THEN '25–44' WHEN p.age < 65 THEN '45–64'
                                       ELSE '65以上' END AS name, count(*) AS n
                            FROM party p JOIN accident a ON a.id = p.accident_id
                            WHERE a.hotspot_id=%(id)s AND p.age IS NOT NULL GROUP BY 1""", hotspot_id)
        recent = _dist(c, """SELECT a.id, a.occurred_at, a.weather, a.light, a.injuries, a.deaths,
                                    ct.minor AS collision, cc.minor AS cause
                             FROM accident a LEFT JOIN collision_type ct ON ct.id = a.collision_type_id
                             LEFT JOIN cause_code cc ON cc.id = a.main_cause_id
                             WHERE a.hotspot_id=%(id)s ORDER BY a.occurred_at DESC LIMIT 8""", hotspot_id)
        if db.postgis:
            reports = c.execute("""SELECT id, created_at, category, description FROM user_report
                                   WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, 120)
                                   ORDER BY created_at DESC LIMIT 10""", {"lat": h["lat"], "lon": h["lon"]}).fetchall()
        else:
            reports = c.execute(f"""SELECT id, created_at, category, description FROM user_report
                                    WHERE {haversine_sql('lat', 'lon')} <= 120
                                    ORDER BY created_at DESC LIMIT 10""", {"lat": h["lat"], "lon": h["lon"]}).fetchall()

    total = h["accident_count"] or 1
    party_total = sum(r["n"] for r in ages) or 1
    elderly = sum(r["n"] for r in ages if r["name"] == "65以上") / party_total
    peak = max(hourly.items(), key=lambda kv: kv[1])[0] if hourly else None
    age_order = ["未滿18", "18–24", "25–44", "45–64", "65以上"]
    return {
        "hotspot": h,
        "summary": {
            "accidents": h["accident_count"], "injuries": h["injury_count"], "deaths": h["death_count"],
            "rain_ratio": round(h["rain_count"] / total, 3), "night_ratio": round(h["night_count"] / total, 3),
            "peak_hour": peak, "elderly_party_ratio": round(elderly, 3),
        },
        "hourly": [hourly.get(i, 0) for i in range(24)],
        "weekday": [weekday.get(i, 0) for i in range(7)],
        "monthly": [{"label": f"{r['year'] - 1911}/{r['month']:02d}", "n": r["n"]} for r in monthly],
        "weather": weather, "light": light, "causes": causes, "collisions": collisions,
        "vehicles": vehicles,
        "ages": sorted(ages, key=lambda r: age_order.index(r["name"])),
        "recent_accidents": recent, "user_reports": reports,
        "advice": build_advice([r["name"] for r in causes[:3]], [r["name"] for r in collisions[:2]],
                               h["rain_count"] / total, h["night_count"] / total, elderly),
        "disclaimer": DISCLAIMER,
    }

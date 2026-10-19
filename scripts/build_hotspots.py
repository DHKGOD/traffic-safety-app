"""依座標格網把「路口事故」彙整成危險路口（hotspot），並回填 accident.hotspot_id。

    uv run python scripts/build_hotspots.py [--cell 0.0004] [--min 3]

做法（一般 SQL，不需 PostGIS）：
1. 取座標有效、且道路型態為「交岔路」或事故位置為「交叉路口」的事故。
2. 以經緯度 / cell（預設 0.0004 度 ≈ 40 公尺）四捨五入成格網，同一格視為同一路口。
3. 事故數 ≥ min 的格子成為 hotspot；中心點取事故座標平均，名稱取最常見的發生地點。
4. 風險分數 = 事故數 + 0.3 ×（受傷人數 − 事故數）+ 10 × 死亡人數。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import database_url  # noqa: E402

PREFIX_RE = re.compile(r"^.{2}[縣市](.{1,3}?[區鄉鎮]|.{1,3}?市)?")
NOISE_RE = re.compile(r"(前|後|旁)?\d+(\.\d+)?公尺(附近)?$|附近$")


def clean_name(text: str) -> str:
    """「新北市新莊區中正路 / 新北市新莊區民安路」→「中正路 / 民安路」。"""
    parts = []
    for p in text.split("/"):
        p = NOISE_RE.sub("", PREFIX_RE.sub("", p.strip().replace("台", "臺"))).strip()
        p = re.sub(r"(路|街|道|段)口$", r"\1", p)  # 「復興路口」→「復興路」
        if p and p not in parts:
            parts.append(p)
    return " / ".join(parts) or text


SQL = """
WITH pts AS (
    SELECT id, lon, lat, weather, hour, injuries, deaths, location_text, city, district,
           round(lon / %(cell)s)::bigint AS gx, round(lat / %(cell)s)::bigint AS gy
    FROM accident
    WHERE coord_valid AND (road_type_major = '交岔路' OR position_major = '交叉路口')
), cells AS (
    SELECT gx, gy,
           count(*)                                            AS n,
           avg(lon)                                            AS lon,
           avg(lat)                                            AS lat,
           sum(injuries)                                       AS inj,
           sum(deaths)                                         AS dead,
           count(*) FILTER (WHERE weather = '雨')               AS rain,
           count(*) FILTER (WHERE hour >= 18 OR hour < 6)      AS night,
           mode() WITHIN GROUP (ORDER BY location_text)        AS name,
           mode() WITHIN GROUP (ORDER BY city)                 AS city,
           mode() WITHIN GROUP (ORDER BY district)             AS district
    FROM pts GROUP BY gx, gy HAVING count(*) >= %(min)s
)
INSERT INTO hotspot (cell_key, name, city, district, lon, lat, is_intersection,
                     accident_count, injury_count, death_count, rain_count, night_count, risk_score)
SELECT gx || ':' || gy, coalesce(name, '未命名路口'), city, district, lon, lat, true,
       n, inj, dead, rain, night, n + 0.3 * (inj - n) + 10 * dead
FROM cells
"""

ASSIGN = """
UPDATE accident a SET hotspot_id = h.id
FROM hotspot h
WHERE a.coord_valid AND (a.road_type_major = '交岔路' OR a.position_major = '交叉路口')
  AND h.cell_key = round(a.lon / %(cell)s)::bigint || ':' || round(a.lat / %(cell)s)::bigint
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", type=float, default=0.0004, help="格網大小（度），預設 0.0004 ≈ 40 公尺")
    ap.add_argument("--min", type=int, default=3, help="成為熱點的最少事故數")
    args = ap.parse_args()
    p = {"cell": args.cell, "min": args.min}
    with psycopg.connect(database_url()) as conn:
        conn.execute("UPDATE user_report SET hotspot_id = NULL")
        conn.execute("UPDATE prediction SET hotspot_id = NULL")
        conn.execute("UPDATE accident SET hotspot_id = NULL WHERE hotspot_id IS NOT NULL")
        conn.execute("DELETE FROM hotspot")
        conn.execute("ALTER SEQUENCE hotspot_id_seq RESTART")
        conn.execute(SQL, p)
        rows = conn.execute("SELECT id, name FROM hotspot").fetchall()
        with conn.cursor() as cur:
            cur.executemany("UPDATE hotspot SET name = %s WHERE id = %s", [(clean_name(n), i) for i, n in rows])
        n = conn.execute(ASSIGN, p).rowcount
        conn.execute("ANALYZE hotspot")
        print(f"危險路口 {len(rows):,} 處，已對應事故 {n:,} 件（格網 {args.cell} 度、至少 {args.min} 件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

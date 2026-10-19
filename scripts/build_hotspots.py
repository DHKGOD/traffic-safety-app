"""依座標格網把「路口事故」彙整成危險路口（hotspot），並回填 accident.hotspot_id。

    uv run python scripts/build_hotspots.py [--cell 0.0004] [--min 3]

做法（一般 SQL，不需 PostGIS）：
1. 取座標有效、且道路型態為「交岔路」或事故位置為「交叉路口」的事故。
2. 以經緯度 / cell（預設 0.0004 度 ≈ 40 公尺）四捨五入成格網。
3. 同一路口常被格線切成相鄰兩格：以事故最多的格子為中心，合併中心點 35 公尺內的相鄰格子。
4. 事故數 ≥ min 的群組成為 hotspot；中心點取事故座標平均，名稱取主要格子最常見的發生地點。
5. 風險分數 = 事故數 + 0.3 ×（受傷人數 − 事故數）+ 10 × 死亡人數。
"""
from __future__ import annotations

import argparse
import math
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


CELLS = """
SELECT round(lon / %(cell)s)::bigint AS gx, round(lat / %(cell)s)::bigint AS gy,
       count(*) AS n, sum(lon) AS slon, sum(lat) AS slat,
       sum(injuries) AS inj, sum(deaths) AS dead,
       count(*) FILTER (WHERE weather = '雨') AS rain,
       count(*) FILTER (WHERE hour >= 18 OR hour < 6) AS night,
       mode() WITHIN GROUP (ORDER BY location_text) AS name,
       mode() WITHIN GROUP (ORDER BY city) AS city,
       mode() WITHIN GROUP (ORDER BY district) AS district
FROM accident
WHERE coord_valid AND (road_type_major = '交岔路' OR position_major = '交叉路口')
GROUP BY 1, 2
"""

ASSIGN = """
UPDATE accident a SET hotspot_id = m.hotspot_id
FROM cell_map m
WHERE a.coord_valid AND (a.road_type_major = '交岔路' OR a.position_major = '交叉路口')
  AND m.gx = round(a.lon / %(cell)s)::bigint AND m.gy = round(a.lat / %(cell)s)::bigint
"""


def meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return math.hypot((lon2 - lon1) * 111320 * math.cos(math.radians(lat1)), (lat2 - lat1) * 110570)


def merge_cells(cells: dict[tuple[int, int], dict], merge_m: float) -> list[list[tuple[int, int]]]:
    """同一個路口常被格線切成相鄰兩格：以事故最多的格子為中心，吸收中心點 merge_m 公尺內的相鄰格子。
    （不做連鎖合併，避免整條路被併成一個點。）"""
    done: set[tuple[int, int]] = set()
    groups = []
    for key in sorted(cells, key=lambda k: (-cells[k]["n"], k)):  # 事故數相同時依座標排序，重建結果才會固定（Codex 審查）
        if key in done:
            continue
        c = cells[key]
        group = [key]
        done.add(key)
        gx, gy = key
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nb = (gx + dx, gy + dy)
                if nb in cells and nb not in done:
                    o = cells[nb]
                    if meters(c["lat"], c["lon"], o["lat"], o["lon"]) <= merge_m:
                        group.append(nb)
                        done.add(nb)
        groups.append(group)
    return groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", type=float, default=0.0004, help="格網大小（度），預設 0.0004 ≈ 40 公尺")
    ap.add_argument("--min", type=int, default=3, help="成為熱點的最少事故數")
    ap.add_argument("--merge", type=float, default=35, help="相鄰格子中心距離在幾公尺內視為同一路口")
    args = ap.parse_args()
    p = {"cell": args.cell}
    with psycopg.connect(database_url()) as conn:
        conn.execute("UPDATE user_report SET hotspot_id = NULL")
        conn.execute("UPDATE prediction SET hotspot_id = NULL")
        conn.execute("UPDATE accident SET hotspot_id = NULL WHERE hotspot_id IS NOT NULL")
        conn.execute("DELETE FROM hotspot")
        conn.execute("ALTER SEQUENCE hotspot_id_seq RESTART")
        cur = conn.execute(CELLS, p)
        cols = [d.name for d in cur.description]
        cells = {}
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["lon"], d["lat"] = d["slon"] / d["n"], d["slat"] / d["n"]
            cells[(d["gx"], d["gy"])] = d
        groups = merge_cells(cells, args.merge)
        rows, mapping = [], []
        for g in groups:
            members = [cells[k] for k in g]
            n = sum(m["n"] for m in members)
            if n < args.min:
                continue
            seed = members[0]
            inj, dead = sum(m["inj"] for m in members), sum(m["dead"] for m in members)
            rows.append((f"{seed['gx']}:{seed['gy']}", clean_name(seed["name"] or "未命名路口"), seed["city"], seed["district"],
                         sum(m["slon"] for m in members) / n, sum(m["slat"] for m in members) / n,
                         n, inj, dead, sum(m["rain"] for m in members), sum(m["night"] for m in members),
                         n + 0.3 * (inj - n) + 10 * dead, g))
        with conn.cursor() as c:
            for r in rows:
                hid = c.execute("""INSERT INTO hotspot (cell_key, name, city, district, lon, lat, is_intersection,
                                       accident_count, injury_count, death_count, rain_count, night_count, risk_score)
                                   VALUES (%s, %s, %s, %s, %s, %s, true, %s, %s, %s, %s, %s, %s) RETURNING id""",
                                r[:12]).fetchone()[0]
                mapping += [(gx, gy, hid) for gx, gy in r[12]]
            c.execute("CREATE TEMP TABLE cell_map (gx bigint, gy bigint, hotspot_id int) ON COMMIT DROP")
            with c.copy("COPY cell_map (gx, gy, hotspot_id) FROM STDIN") as cp:
                for m in mapping:
                    cp.write_row(m)
            c.execute("CREATE INDEX ON cell_map (gx, gy)")
            n = c.execute(ASSIGN, p).rowcount
        merged = sum(1 for r in rows if len(r[12]) > 1)
        conn.execute("ANALYZE hotspot")
        print(f"危險路口 {len(rows):,} 處（其中 {merged:,} 處由相鄰格子合併），已對應事故 {n:,} 件"
              f"（格網 {args.cell} 度、合併距離 {args.merge} 公尺、至少 {args.min} 件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
"""座標品質檢查：把不可信的事故座標標成 coord_valid=false（資料保留，只是不做空間分析）。

    uv run python scripts/clean_coords.py

規則（一般 SQL，不需 PostGIS）：
1. out_of_taiwan     ：匯入時已判定（經緯度不在台灣範圍）。
2. shared_default    ：約 50 公尺格網內出現 ≥ 4 個不同行政區的事故 → 該格全部視為「預設座標」。
                       真實路口最多跨 2–3 個行政區；實測新北市約 4,500 件事故都落在板橋同一點附近。
3. far_from_district ：座標離「地址所屬行政區的事故中位數位置」超過 10 公里（例如高雄左營區的事故標在台北車站）。
規則 2、3 用「其餘仍有效的事故」反覆計算，避免被錯誤座標本身影響。
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import database_url  # noqa: E402

CELL = 0.0005
MIN_DISTRICTS = 4
FAR_KM = 10

# 先把之前標記過的恢復（重跑時結果一致）
RESTORE = """UPDATE accident SET coord_valid = true, coord_flag = NULL
             WHERE coord_flag IN ('shared_default', 'far_from_district')"""

SHARED = f"""
WITH cells AS (
    SELECT round(lon / {CELL})::bigint AS gx, round(lat / {CELL})::bigint AS gy
    FROM accident WHERE coord_valid AND district IS NOT NULL
    GROUP BY 1, 2 HAVING count(DISTINCT district) >= {MIN_DISTRICTS}
)
UPDATE accident a SET coord_valid = false, coord_flag = 'shared_default'
FROM cells c
WHERE a.coord_valid AND round(a.lon / {CELL})::bigint = c.gx AND round(a.lat / {CELL})::bigint = c.gy
"""

FAR = f"""
WITH centers AS (
    SELECT city, district,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lon) AS clon,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS clat,
           count(*) AS n
    FROM accident WHERE coord_valid AND district IS NOT NULL
    GROUP BY city, district HAVING count(*) >= 20
)
UPDATE accident a SET coord_valid = false, coord_flag = 'far_from_district'
FROM centers c
WHERE a.coord_valid AND a.city = c.city AND a.district = c.district
  AND sqrt(power((a.lon - c.clon) * 111.32 * cos(radians(c.clat)), 2) + power((a.lat - c.clat) * 110.57, 2)) > {FAR_KM}
"""


def main() -> int:
    with psycopg.connect(database_url()) as conn:
        conn.execute(RESTORE)
        conn.execute("UPDATE accident SET coord_flag = 'out_of_taiwan' WHERE NOT coord_valid AND coord_flag IS NULL")
        shared = conn.execute(SHARED).rowcount
        far = conn.execute(FAR).rowcount
        rows = conn.execute("""SELECT coalesce(coord_flag, '有效') AS flag, count(*) FROM accident
                               GROUP BY 1 ORDER BY 2 DESC""").fetchall()
        conn.commit()
    print(f"共用預設座標：{shared:,} 件；離行政區太遠：{far:,} 件")
    for flag, n in rows:
        print(f"  {flag}: {n:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

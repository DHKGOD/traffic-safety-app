"""取得 Demo 路線（輔大 → 捷運新莊站）的實際步行路徑，存成前端的靜態檔。

    uv run python scripts/fetch_demo_route.py

來源：FOSSGIS 提供的 OSRM 步行路線服務（routing.openstreetmap.de，資料 © OpenStreetMap 貢獻者）。
只在開發時執行一次，App 執行時不依賴外部路線服務。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import truststore

truststore.inject_into_ssl()
import httpx  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "src" / "data" / "demo-route.json"
START = {"name": "輔仁大學", "lat": 25.0355, "lon": 121.4330}
END = {"name": "捷運新莊站", "lat": 25.0363, "lon": 121.4522}


def main() -> int:
    url = (f"https://routing.openstreetmap.de/routed-foot/route/v1/foot/"
           f"{START['lon']},{START['lat']};{END['lon']},{END['lat']}?overview=full&geometries=geojson")
    r = httpx.get(url, timeout=60).json()
    route = r["routes"][0]
    data = {
        "id": "fju-xinzhuang",
        "name": "輔大 → 新莊捷運站",
        "start": START, "end": END,
        "distance_m": round(route["distance"]),
        "duration_s": round(route["duration"]),
        "points": [[round(lat, 6), round(lon, 6)] for lon, lat in route["geometry"]["coordinates"]],
        "source": "OSRM foot (routing.openstreetmap.de) © OpenStreetMap contributors",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"已寫入 {OUT.relative_to(ROOT)}：{data['distance_m']} 公尺、{len(data['points'])} 點")
    return 0


if __name__ == "__main__":
    sys.exit(main())

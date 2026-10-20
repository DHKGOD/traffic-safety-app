"""AI 任務 2：天候風險校正——用氣象署測站的實際雨量，取代事故資料「天候」欄＋全國雨天比例的舊算法。

    uv run python ai/rain_risk.py            # 下載雨量、評估、寫入資料庫（hotspot_rain_risk、model_version）
    uv run python ai/rain_risk.py --no-db    # 只評估，不寫資料庫
    uv run python ai/rain_risk.py --offline  # 不重新下載，用 data/raw/cwa/ 的快取

資料：氣象署 C-B0025-001 每日雨量（2026-01-01 起）；測站座標取自 O-A0003-001，缺的再查 O-A0001-001。
每個行政區（事故座標平均點）對應 MAX_KM 內最近的測站；測站當天雨量 ≥ 1 mm 為雨天。

兩部分（都用時間切分：1–6 月估計、7 月起測試）：
  A. 每天事故數模型（Poisson 迴歸）：行政區＋星期幾＋雨量強度，和「只用行政區平均」「行政區＋星期幾」比較，
     看雨量到底讓事故變多還是變少。
  B. 路口雨天標記：路口雨天事故占比 vs 同一區預期占比（同區事故發生在雨天的比例，已反映當地下雨天數），
     二項檢定＋Benjamini–Hochberg 控制誤報後才標「雨天特別容易出事」；
     驗證：1–6 月標記的路口，7 月起雨天事故是否真的比預期多，並和舊算法（天候欄雨天占比 ≥ 20%）比較。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import psycopg
import truststore
from scipy.stats import binomtest
from sklearn.linear_model import PoissonRegressor
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from common import database_url, env  # noqa: E402

truststore.inject_into_ssl()

BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
CACHE = ROOT / "data" / "raw" / "cwa"
RAIN_MM = 1.0              # 每日雨量達此值為雨天
BINS = [-1, RAIN_MM - 1e-6, 10, 30, 80, 1e9]
BIN_LABELS = ["晴（<1 mm）", "小雨 1–10 mm", "中雨 10–30 mm", "大雨 30–80 mm", "豪雨 ≥80 mm"]
MAX_KM = 30                # 行政區中心離測站超過這個距離就不採用
START = date(2026, 1, 1)
SPLIT = date(2026, 7, 1)   # 之前估計、之後測試
MIN_N = 8                  # 路口事故少於這個數不做檢定
FDR = 0.05                 # Benjamini–Hochberg 誤報率
NAME = "rain_risk"
TASK = "天候風險校正：測站實際雨量 → 每日事故模型＋路口雨天標記"


# ---------- 雨量 ----------
def fetch(dataset: str, refresh: bool) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{dataset}.json"
    key = env("CWA_API_KEY", "").strip()
    if refresh and key:
        r = httpx.get(BASE + dataset, params={"Authorization": key, "format": "JSON"}, timeout=180)
        r.raise_for_status()
        path.write_bytes(r.content)
    if not path.exists():
        raise SystemExit(f"沒有 {dataset} 的資料：請在 .env 設定 CWA_API_KEY（或先放好 {path}）")
    return json.loads(path.read_text(encoding="utf-8"))


def parse_mm(v: str) -> float | None:
    """數字照用；T（微量）記 0；空白、X（缺測）記 None。"""
    if v == "T":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def wgs84(station: dict) -> tuple[float, float] | None:
    for c in station.get("GeoInfo", {}).get("Coordinates", []):
        if c.get("CoordinateName") == "WGS84":
            return float(c["StationLongitude"]), float(c["StationLatitude"])
    return None


def load_rain(refresh: bool) -> tuple[dict[str, dict], dict[str, dict[date, float | None]]]:
    stations: dict[str, dict] = {}
    rain: dict[str, dict[date, float | None]] = {}
    for loc in fetch("C-B0025-001", refresh)["records"]["location"]:
        sid = loc["station"]["StationID"]
        stations[sid] = {"name": loc["station"]["StationName"], "lon": None, "lat": None}
        rain[sid] = {date.fromisoformat(o["Date"]): parse_mm(o["weatherElements"]["Precipitation"])
                     for o in loc["stationObsTimes"]["stationObsTime"]}
    for ds in ("O-A0003-001", "O-A0001-001"):
        missing = {s for s, v in stations.items() if v["lon"] is None}
        if not missing:
            break
        for st in fetch(ds, refresh)["records"]["Station"]:
            if st["StationId"] in missing and (xy := wgs84(st)):
                stations[st["StationId"]]["lon"], stations[st["StationId"]]["lat"] = xy
    return stations, rain


def km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


def assign(centers: dict, stations: dict) -> dict:
    """行政區 → (最近測站, 距離 km)；超過 MAX_KM 的不列入。"""
    usable = {s: v for s, v in stations.items() if v["lon"] is not None}
    out = {}
    for key, (lon, lat) in centers.items():
        sid, dist = min(((s, km(lon, lat, v["lon"], v["lat"])) for s, v in usable.items()), key=lambda t: t[1])
        if dist <= MAX_KM:
            out[key] = (sid, dist)
    return out


# ---------- 事故 ----------
def load_accidents(conn, assigned: dict, rain: dict) -> tuple[pd.DataFrame, date]:
    """每列：一個行政區某天某路口的事故數（含測站雨量）。缺測或沒有測站的略過。"""
    rows = conn.execute(
        """SELECT city, district, occurred_at::date, hotspot_id, count(*), count(*) FILTER (WHERE weather = '雨')
           FROM accident WHERE city IS NOT NULL AND district IS NOT NULL GROUP BY 1, 2, 3, 4""").fetchall()
    out = []
    for city, dist, d, hid, n, lab in rows:
        a = assigned.get((city, dist))
        mm = rain[a[0]].get(d) if a else None
        if mm is not None:
            out.append((city + dist, d, hid, n, lab, mm))
    last = conn.execute("SELECT max(occurred_at)::date FROM accident").fetchone()[0]
    return pd.DataFrame(out, columns=["dist", "d", "hid", "n", "lab", "mm"]), last


def district_panel(acc: pd.DataFrame, assigned: dict, rain: dict, last: date) -> pd.DataFrame:
    """行政區 × 每一天（含沒事故的日子）。"""
    counts = acc.groupby(["dist", "d"]).n.sum().to_dict()
    rows = [(c + d, day, mm, counts.get((c + d, day), 0))
            for (c, d), (sid, _) in assigned.items()
            for day, mm in rain[sid].items() if mm is not None and START <= day <= last]
    p = pd.DataFrame(rows, columns=["dist", "d", "mm", "y"])
    p["bin"] = pd.cut(p.mm, BINS, labels=BIN_LABELS).astype(str)
    p["wd"] = p.d.map(lambda x: str(x.weekday()))
    return p


# ---------- A. 每天事故數模型 ----------
def deviance(y: np.ndarray, lam: np.ndarray) -> float:
    lam = np.maximum(lam, 1e-9)
    safe = np.where(y > 0, y, 1)
    return float(2 * (np.where(y > 0, y * np.log(safe / lam), 0.0) - (y - lam)).mean())


def fit_poisson(train: pd.DataFrame, cols: list[str]):
    enc = OneHotEncoder(handle_unknown="ignore").fit(train[cols])
    model = PoissonRegressor(alpha=1e-6, max_iter=3000).fit(enc.transform(train[cols]), train.y)
    return enc, model


def daily_model(panel: pd.DataFrame) -> dict:
    tr, te = panel[panel.d < SPLIT], panel[panel.d >= SPLIT]
    res = {}
    for name, cols in (("baseline_district", ["dist"]), ("baseline_district_weekday", ["dist", "wd"]),
                       ("model_district_weekday_rain", ["dist", "wd", "bin"])):
        enc, m = fit_poisson(tr, cols)
        lam = m.predict(enc.transform(te[cols]))
        wet = (te.mm >= RAIN_MM).values
        res[name] = {"deviance": round(deviance(te.y.values, lam), 5),
                     "deviance_rainy_days": round(deviance(te.y.values[wet], lam[wet]), 5),
                     "mae": round(float(np.abs(te.y.values - lam).mean()), 5)}
    # 全期間重新估計，取雨量強度的倍數（相對於晴天）
    enc, m = fit_poisson(panel, ["dist", "wd", "bin"])
    coef = dict(zip(enc.get_feature_names_out(), m.coef_))
    base = coef[f"bin_{BIN_LABELS[0]}"]
    res["rain_factor"] = {b: round(math.exp(coef[f"bin_{b}"] - base), 3) for b in BIN_LABELS if f"bin_{b}" in coef}
    res["days_by_bin"] = {b: int(n) for b, n in panel.groupby("bin").size().items()}
    res["n_test"] = int(len(te))
    return res


# ---------- B. 路口雨天標記 ----------
def bh(p: np.ndarray, q: float) -> np.ndarray:
    """Benjamini–Hochberg：回傳哪些檢定顯著。"""
    if len(p) == 0:
        return np.zeros(0, bool)
    order = np.argsort(p)
    thresh = q * np.arange(1, len(p) + 1) / len(p)
    passed = p[order] <= thresh
    k = np.max(np.nonzero(passed)[0]) + 1 if passed.any() else 0
    out = np.zeros(len(p), bool)
    out[order[:k]] = True
    return out


def flag_hotspots(acc: pd.DataFrame) -> pd.DataFrame:
    """每個路口：n 件事故、k 件在雨天、同區預期占比 p0 → 二項檢定 → BH → level。"""
    acc = acc.assign(wet=(acc.mm >= RAIN_MM) * acc.n)
    share = acc.groupby("dist").wet.sum() / acc.groupby("dist").n.sum()
    h = acc.dropna(subset=["hid"]).groupby("hid").agg(n=("n", "sum"), k=("wet", "sum"), lab=("lab", "sum"),
                                                     dist=("dist", "first"))
    h["p0"] = h.dist.map(share).clip(1e-3, 1 - 1e-3)
    h["tested"] = h.n >= MIN_N  # 事故太少的不檢定，一律 normal（證據不足）
    h["p"] = [binomtest(int(k), int(n), p0).pvalue if t else 1.0 for k, n, p0, t in zip(h.k, h.n, h.p0, h.tested)]
    sig = np.zeros(len(h), bool)
    sig[h.tested.values] = bh(h.p.values[h.tested.values], FDR)
    h["level"] = np.where(sig & (h.k > h.n * h.p0), "rain_high", np.where(sig, "rain_low", "normal"))
    return h


def validate_flags(acc: pd.DataFrame) -> dict:
    """1–6 月標記的路口，7 月起雨天事故是否真的比預期多（觀察 ÷ 預期，>1 表示真的偏多）。"""
    tr, te = acc[acc.d < SPLIT], acc[acc.d >= SPLIT]
    flags = flag_hotspots(tr)
    old = tr.dropna(subset=["hid"]).groupby("hid").agg(n=("n", "sum"), lab=("lab", "sum"))
    old_high = set(old.index[(old.n >= MIN_N) & (old.lab / old.n >= 0.2)])
    te = te.assign(wet=(te.mm >= RAIN_MM) * te.n)
    share = te.groupby("dist").wet.sum() / te.groupby("dist").n.sum()
    th = te.dropna(subset=["hid"]).groupby("hid").agg(n=("n", "sum"), k=("wet", "sum"), dist=("dist", "first"))
    th["exp"] = th.n * th.dist.map(share)

    def lift(ids) -> dict:
        t = th[th.index.isin(ids)]
        return {"hotspots": int(len(t)), "test_accidents": int(t.n.sum()),
                "observed_rainy": int(t.k.sum()), "expected_rainy": round(float(t.exp.sum()), 1),
                "lift": round(float(t.k.sum() / t.exp.sum()), 3) if t.exp.sum() else None}

    tested = flags[flags.tested]
    return {"new_rain_high": lift(set(tested.index[tested.level == "rain_high"])),
            "new_normal": lift(set(tested.index[tested.level == "normal"])),
            "old_rain_high": lift(old_high),
            "old_normal": lift(set(old.index[old.n >= MIN_N]) - old_high),
            "tested_hotspots": int(len(tested))}


# ---------- 主程式 ----------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db", action="store_true")
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    version = datetime.now().strftime("%Y.%m.%d-%H%M")
    print("讀取氣象署雨量…")
    stations, rain = load_rain(refresh=not args.offline)
    print(f"測站 {len(stations)} 個（有座標 {sum(v['lon'] is not None for v in stations.values())} 個）")
    with psycopg.connect(database_url()) as conn:
        centers = {(r[0], r[1]): (r[2], r[3]) for r in conn.execute(
            """SELECT city, district, avg(lon), avg(lat) FROM accident
               WHERE coord_valid AND coord_flag IS NULL AND city IS NOT NULL AND district IS NOT NULL
               GROUP BY city, district""")}
        assigned = assign(centers, stations)
        acc, last = load_accidents(conn, assigned, rain)
        print(f"行政區 {len(centers)} 個，{MAX_KM} 公里內有測站的 {len(assigned)} 個；"
              f"可對到雨量的事故 {int(acc.n.sum()):,} 件（資料到 {last}）")
        panel = district_panel(acc, assigned, rain, last)
        daily = daily_model(panel)
        valid = validate_flags(acc)
        flags = flag_hotspots(acc)
        wet = acc.mm >= RAIN_MM
        agree = {"rainy_day": {"accidents": int(acc.n[wet].sum()), "labeled_rain": int(acc.lab[wet].sum())},
                 "dry_day": {"accidents": int(acc.n[~wet].sum()), "labeled_rain": int(acc.lab[~wet].sum())}}
        metrics = {"daily_model": daily, "hotspot_flag_validation": valid, "label_agreement": agree,
                   "hotspot_levels": {k: int(v) for k, v in flags.level.value_counts().items()},
                   "districts": len(assigned), "rain_mm": RAIN_MM, "max_km": MAX_KM, "fdr": FDR, "min_n": MIN_N}
        print(json.dumps(metrics, ensure_ascii=False, indent=1))
        if not args.no_db:
            save(conn, version, last, metrics, stations, rain, flags, assigned)
    write_report(metrics, version)
    print(f"完成：{NAME} 版本 {version}，報告 docs/ai-report-rain.md")
    return 0


def save(conn, version, last, metrics, stations, rain, flags, assigned) -> None:
    station_of = {c + d: sid for (c, d), (sid, _) in assigned.items()}
    with conn.transaction():
        conn.execute("UPDATE model_version SET is_active = false WHERE name = %s", (NAME,))
        mv = conn.execute(
            """INSERT INTO model_version (name, version, task, algorithm, train_range, test_range, metrics, baseline,
                                          is_active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)
               ON CONFLICT (name, version) DO UPDATE SET metrics = EXCLUDED.metrics, is_active = true RETURNING id""",
            (NAME, version, TASK, "Poisson 迴歸（行政區＋星期＋雨量強度）；路口二項檢定＋BH",
             "115/01–115/06", f"115/07–{last.year - 1911}/{last.month:02d}",
             json.dumps(metrics, ensure_ascii=False),
             json.dumps({k: v for k, v in metrics["daily_model"].items() if k.startswith("baseline")}
                        | {"old_rain_high": metrics["hotspot_flag_validation"]["old_rain_high"]},
                        ensure_ascii=False))).fetchone()[0]
        conn.execute("DELETE FROM hotspot_rain_risk")
        conn.execute("DELETE FROM rain_station")
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO rain_station VALUES (%s, %s, %s, %s)",
                            [(s, v["name"], v["lon"], v["lat"]) for s, v in stations.items()])
            cur.executemany("INSERT INTO rain_station_daily VALUES (%s, %s, %s)",
                            [(s, d, mm) for s, days in rain.items() for d, mm in days.items()])
            cur.executemany(
                "INSERT INTO hotspot_rain_risk VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                [(int(hid), station_of.get(r.dist), int(r.n), int(r.k), round(float(r.p0), 4), float(r.p), r.level, mv)
                 for hid, r in flags.iterrows()])


def write_report(m: dict, version: str) -> None:
    d, v, ag = m["daily_model"], m["hotspot_flag_validation"], m["label_agreement"]
    names = {"baseline_district": "基準 A：行政區平均", "baseline_district_weekday": "基準 B：行政區＋星期幾",
             "model_district_weekday_rain": "**模型：行政區＋星期幾＋雨量強度**"}
    lines = [
        "# AI 任務 2：天候風險校正（氣象署測站實際雨量）", "",
        f"版本：`{version}`（{datetime.now():%Y-%m-%d %H:%M}，`uv run python ai/rain_risk.py` 產生）", "",
        f"- 雨量：氣象署 C-B0025-001 每日雨量；{m['districts']} 個行政區各對應 {MAX_KM} 公里內最近的測站；"
        f"當天 ≥ {RAIN_MM:g} mm 為雨天。",
        "- 時間切分：1–6 月估計、7 月起測試。", "",
        "## A. 每天事故數：雨量讓事故變多還是變少？", "",
        "| 方法 | deviance（全部日子） | deviance（雨天） | MAE |", "|---|---:|---:|---:|"]
    for k, label in names.items():
        r = d[k]
        lines.append(f"| {label} | {r['deviance']:.4f} | {r['deviance_rainy_days']:.4f} | {r['mae']:.4f} |")
    lines += ["", f"測試 {d['n_test']:,} 區·日；Poisson deviance 越低越好。", "",
              "同一區、同一個星期幾，不同雨量下每天事故數是晴天的幾倍：", "", "| 雨量 | 倍數 | 區·日數 |", "|---|---:|---:|"]
    for b, f in d["rain_factor"].items():
        lines.append(f"| {b} | {f:.2f} | {d['days_by_bin'].get(b, 0):,} |")
    lines += ["", "解讀：下雨天的事故「件數」沒有變多，大雨反而較少——下雨時出門、騎車的人變少（暴露量下降）。"
              "所以不能用「雨天事故件數」說雨天比較危險，要看同一個地方雨天事故占比是否比預期高（B）。", "",
              "## B. 路口「雨天特別容易出事」標記", "",
              f"每個路口（事故 ≥ {MIN_N} 件）比較：雨天事故占比 vs 同一區預期占比（已反映當地下雨天數），"
              f"二項檢定後用 Benjamini–Hochberg 控制誤報率 {FDR:.0%}。", "",
              "驗證：1–6 月標記的路口，7 月起雨天事故「實際 ÷ 預期」（> 1 表示真的偏多）：", "",
              "| 標記方式 | 路口數 | 測試期事故 | 雨天實際 | 雨天預期 | 實際 ÷ 預期 |", "|---|---:|---:|---:|---:|---:|"]
    for k, label in (("new_rain_high", "**新：測站雨量＋檢定，標「雨天偏多」**"), ("new_normal", "新：未標記（一般）"),
                     ("old_rain_high", "舊：天候欄雨天占比 ≥ 20%（標「雨天特別容易出事」）"),
                     ("old_normal", "舊：其餘路口")):
        r = v[k]
        lift = f"{r['lift']:.2f}" if r["lift"] is not None else "—"
        lines.append(f"| {label} | {r['hotspots']:,} | {r['test_accidents']:,} | {r['observed_rainy']:,} | "
                     f"{r['expected_rainy']:,} | {lift} |")
    lv = m["hotspot_levels"]
    lines += ["", f"在 1–6 月檢定的 {v['tested_hotspots']:,} 個路口中，新方法標為雨天偏多的有 {v['new_rain_high']['hotspots']} 個。"
              "舊算法標的路口，測試期的「實際 ÷ 預期」若和其餘路口差不多，就代表舊標記只是雜訊，不能據此說「雨天特別容易出事」。", "",
              f"全期間結果（App 使用）：雨天偏多 {lv.get('rain_high', 0)} 個、雨天偏少 {lv.get('rain_low', 0)} 個、"
              f"一般 {lv.get('normal', 0)} 個路口（事故 < {MIN_N} 件的一律算一般）。", "",
              "## 舊算法的偏差", "",
              "事故資料的「天候」欄是到場時的天氣，和測站當天是否下雨不完全一致：", "",
              "| 測站判定 | 事故數 | 其中天候記為「雨」 |", "|---|---:|---:|"]
    for k, label in (("rainy_day", "雨天"), ("dry_day", "晴天")):
        a = ag[k]
        lines.append(f"| {label} | {a['accidents']:,} | {a['labeled_rain'] / max(a['accidents'], 1):.1%} |")
    lines += ["", "App 的路口報告「什麼時候容易出事」：有 `hotspot_rain_risk` 時依這裡的標記說明晴天或雨天，"
              "沒有時（事故太少或附近沒測站）才退回天候欄的舊判斷。"]
    (ROOT / "docs" / "ai-report-rain.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    sys.exit(main())

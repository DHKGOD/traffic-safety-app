"""把 data/raw/ 的交通事故原始檔匯入資料庫（會先清空事故相關資料表再重建）。

    uv run python scripts/import_accidents.py

- 原始 CSV 一列是一位當事人；同一件事故的當事人連續排列，「當事者順位=1」代表新事故開始。
- 事故層級欄位取順位 1 那列；每一列都寫進 party。
- 使用者回報、模型版本與預測紀錄不會被清除。
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url  # noqa: E402

RAW = ROOT / "data" / "raw"

# 原始欄位（51 欄）名稱 → 索引
COLS = ['發生年度', '發生月份', '發生日期', '發生時間', '事故類別名稱', '處理單位名稱警局層', '發生地點', '天候名稱',
        '光線名稱', '道路類別-第1當事者-名稱', '速限-第1當事者', '道路型態大類別名稱', '道路型態子類別名稱',
        '事故位置大類別名稱', '事故位置子類別名稱', '路面狀況-路面鋪裝名稱', '路面狀況-路面狀態名稱',
        '路面狀況-路面缺陷名稱', '道路障礙-障礙物名稱', '道路障礙-視距品質名稱', '道路障礙-視距名稱',
        '號誌-號誌種類名稱', '號誌-號誌動作名稱', '車道劃分設施-分向設施大類別名稱', '車道劃分設施-分向設施子類別名稱',
        '車道劃分設施-分道設施-快車道或一般車道間名稱', '車道劃分設施-分道設施-快慢車道間名稱',
        '車道劃分設施-分道設施-路面邊線名稱', '事故類型及型態大類別名稱', '事故類型及型態子類別名稱',
        '肇因研判大類別名稱-主要', '肇因研判子類別名稱-主要', '死亡受傷人數', '當事者順位',
        '當事者區分-類別-大類別名稱-車種', '當事者區分-類別-子類別名稱-車種', '當事者屬-性-別名稱',
        '當事者事故發生時年齡', '保護裝備名稱', '行動電話或電腦或其他相類功能裝置名稱', '當事者行動狀態大類別名稱',
        '當事者行動狀態子類別名稱', '車輛撞擊部位大類別名稱-最初', '車輛撞擊部位子類別名稱-最初',
        '車輛撞擊部位大類別名稱-其他', '車輛撞擊部位子類別名稱-其他', '肇因研判大類別名稱-個別',
        '肇因研判子類別名稱-個別', '肇事逃逸類別名稱-是否肇逃', '經度', '緯度']
I = {name: i for i, name in enumerate(COLS)}

ACCIDENT_COLS = ["id", "batch_id", "accident_class", "occurred_at", "year", "month", "hour", "weekday",
                 "police_unit", "location_text", "city", "district", "weather", "light", "road_class",
                 "speed_limit", "road_type_major", "road_type_minor", "position_major", "position_minor",
                 "surface_pave", "surface_state", "surface_defect", "obstacle", "sight_quality", "sight",
                 "signal_type", "signal_action", "divider_major", "divider_minor", "lane_fast", "lane_fast_slow",
                 "edge_line", "collision_type_id", "main_cause_id", "deaths", "injuries", "party_count",
                 "lon", "lat", "coord_valid"]
PARTY_COLS = ["accident_id", "party_order", "vehicle_major", "vehicle_minor", "sex", "age", "protection",
              "phone_use", "action_major", "action_minor", "impact_initial_major", "impact_initial_minor",
              "impact_other_major", "impact_other_minor", "cause_id", "hit_and_run"]

CITY_RE = re.compile(r"^(.{2}[縣市])")
DIST_RE = (re.compile(r"^.{2}[縣市](.{1,3}?[區鄉鎮])"), re.compile(r"^.{2}[縣市](.{1,3}?市)"))
DEATH_RE = re.compile(r"死亡(\d+);受傷(\d+)")
TAIWAN_BBOX = (118.0, 21.8, 122.1, 26.5)  # lon_min, lat_min, lon_max, lat_max（含金門、馬祖）


def nz(s: str) -> str | None:
    s = s.strip()
    return s or None


def to_int(s: str) -> int | None:
    try:
        return int(float(s))
    except (TypeError, ValueError, OverflowError):  # OverflowError：「inf」（Codex 測試發現）
        return None


def to_float(s: str) -> float | None:
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None  # inf／nan 視為空值，避免破壞座標計算


def parse_location(text: str) -> tuple[str | None, str | None]:
    text = text.replace("台", "臺")
    m = CITY_RE.match(text)
    city = m.group(1) if m else None
    district = None
    for rx in DIST_RE:
        m = rx.match(text)
        if m:
            district = m.group(1)
            break
    return city, district


def read_csv_rows(path: Path) -> list[list[str]]:
    """讀出資料列（略過標頭與檔尾「資料提供日期」等說明列）。"""
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.upper().startswith("NPA_") and n.endswith(".csv"))
            text = z.read(name).decode("utf-8-sig")
    else:
        text = path.read_text(encoding="utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    if rows[0] != COLS:
        raise SystemExit(f"{path.name} 欄位與預期不同，資料格式可能改版：{rows[0][:5]}…")
    return [r for r in rows[1:] if len(r) == len(COLS) and r[0].isdigit()]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass
class CodeBook:
    """肇因／事故型態代碼：先收集所有 (大類, 子類)，再一次寫入並取回 id。"""
    table: str
    ids: dict[tuple[str, str], int] = field(default_factory=dict)

    def load(self, conn: psycopg.Connection, pairs: set[tuple[str, str]]) -> None:
        with conn.cursor() as cur:
            cur.executemany(f"INSERT INTO {self.table}(major, minor) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                            sorted(pairs))
            self.ids = {(a, b): i for i, a, b in cur.execute(f"SELECT id, major, minor FROM {self.table}")}

    def get(self, major: str, minor: str) -> int | None:
        major, minor = major.strip(), minor.strip()
        if not major and not minor:
            return None
        return self.ids.get((major, minor))


def main() -> int:
    files = sorted((RAW / "a2_115").glob("*.zip"), key=lambda p: int(re.search(r"_(\d+)\.zip$", p.name).group(1)))
    if not files:
        raise SystemExit("data/raw/a2_115/ 沒有資料，請先執行 scripts/download_data.py")
    t0 = time.time()
    print(f"讀取 {len(files)} 個原始檔…")
    data = [(f, read_csv_rows(f)) for f in files]

    cause_pairs: set[tuple[str, str]] = set()
    coll_pairs: set[tuple[str, str]] = set()
    for _, rows in data:
        for r in rows:
            for a, b in ((I['肇因研判大類別名稱-主要'], I['肇因研判子類別名稱-主要']),
                         (I['肇因研判大類別名稱-個別'], I['肇因研判子類別名稱-個別'])):
                if r[a].strip() or r[b].strip():
                    cause_pairs.add((r[a].strip(), r[b].strip()))
            coll_pairs.add((r[I['事故類型及型態大類別名稱']].strip(), r[I['事故類型及型態子類別名稱']].strip()))

    with psycopg.connect(database_url()) as conn:
        print("清空事故相關資料表（保留使用者回報與模型紀錄）…")
        conn.execute("UPDATE user_report SET hotspot_id = NULL")
        conn.execute("UPDATE prediction SET hotspot_id = NULL")
        conn.execute("TRUNCATE party, accident, import_batch RESTART IDENTITY")
        conn.execute("DELETE FROM hotspot")
        conn.execute("ALTER SEQUENCE hotspot_id_seq RESTART")
        causes, colls = CodeBook("cause_code"), CodeBook("collision_type")
        causes.load(conn, cause_pairs)
        colls.load(conn, coll_pairs)

        acc_id = 0
        total_acc = total_party = 0
        for path, rows in data:
            batch_id = conn.execute(
                "INSERT INTO import_batch(source_file, sha256, dataset_id) VALUES (%s, %s, 13139) RETURNING id",
                (str(path.relative_to(ROOT)).replace("\\", "/"), sha256(path))).fetchone()[0]
            accidents: list[list] = []
            parties: list[tuple] = []
            for r in rows:
                order = to_int(r[I['當事者順位']]) or 0
                if order == 1 or not accidents:
                    acc_id += 1
                    d, t = r[I['發生日期']], r[I['發生時間']].zfill(6)
                    occurred = datetime.strptime(d + t, "%Y%m%d%H%M%S")
                    loc = r[I['發生地點']].strip()
                    city, district = parse_location(loc)
                    m = DEATH_RE.search(r[I['死亡受傷人數']])
                    deaths, injuries = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
                    lon, lat = to_float(r[I['經度']]), to_float(r[I['緯度']])
                    valid = (lon is not None and lat is not None
                             and TAIWAN_BBOX[0] <= lon <= TAIWAN_BBOX[2] and TAIWAN_BBOX[1] <= lat <= TAIWAN_BBOX[3])
                    accidents.append([
                        acc_id, batch_id, r[I['事故類別名稱']].strip() or "A2", occurred, occurred.year, occurred.month,
                        occurred.hour, occurred.weekday(), nz(r[I['處理單位名稱警局層']]), loc or None, city, district,
                        nz(r[I['天候名稱']]), nz(r[I['光線名稱']]), nz(r[I['道路類別-第1當事者-名稱']]),
                        to_int(r[I['速限-第1當事者']]), nz(r[I['道路型態大類別名稱']]), nz(r[I['道路型態子類別名稱']]),
                        nz(r[I['事故位置大類別名稱']]), nz(r[I['事故位置子類別名稱']]),
                        nz(r[I['路面狀況-路面鋪裝名稱']]), nz(r[I['路面狀況-路面狀態名稱']]),
                        nz(r[I['路面狀況-路面缺陷名稱']]), nz(r[I['道路障礙-障礙物名稱']]),
                        nz(r[I['道路障礙-視距品質名稱']]), nz(r[I['道路障礙-視距名稱']]),
                        nz(r[I['號誌-號誌種類名稱']]), nz(r[I['號誌-號誌動作名稱']]),
                        nz(r[I['車道劃分設施-分向設施大類別名稱']]), nz(r[I['車道劃分設施-分向設施子類別名稱']]),
                        nz(r[I['車道劃分設施-分道設施-快車道或一般車道間名稱']]),
                        nz(r[I['車道劃分設施-分道設施-快慢車道間名稱']]),
                        nz(r[I['車道劃分設施-分道設施-路面邊線名稱']]),
                        colls.get(r[I['事故類型及型態大類別名稱']], r[I['事故類型及型態子類別名稱']]),
                        causes.get(r[I['肇因研判大類別名稱-主要']], r[I['肇因研判子類別名稱-主要']]),
                        deaths, injuries, 0, lon, lat, valid,  # 無效座標保留原值但 coord_valid=false
                    ])
                accidents[-1][37] += 1  # party_count
                age = to_int(r[I['當事者事故發生時年齡']])
                hr = r[I['肇事逃逸類別名稱-是否肇逃']].strip()
                parties.append((
                    acc_id, order, nz(r[I['當事者區分-類別-大類別名稱-車種']]), nz(r[I['當事者區分-類別-子類別名稱-車種']]),
                    nz(r[I['當事者屬-性-別名稱']]), age if age is not None and age >= 0 else None,
                    nz(r[I['保護裝備名稱']]), nz(r[I['行動電話或電腦或其他相類功能裝置名稱']]),
                    nz(r[I['當事者行動狀態大類別名稱']]), nz(r[I['當事者行動狀態子類別名稱']]),
                    nz(r[I['車輛撞擊部位大類別名稱-最初']]), nz(r[I['車輛撞擊部位子類別名稱-最初']]),
                    nz(r[I['車輛撞擊部位大類別名稱-其他']]), nz(r[I['車輛撞擊部位子類別名稱-其他']]),
                    causes.get(r[I['肇因研判大類別名稱-個別']], r[I['肇因研判子類別名稱-個別']]),
                    True if hr == "是" else False if hr == "否" else None,
                ))
            with conn.cursor() as cur:
                with cur.copy(f"COPY accident ({', '.join(ACCIDENT_COLS)}) FROM STDIN") as cp:
                    for a in accidents:
                        cp.write_row(a)
                with cur.copy(f"COPY party ({', '.join(PARTY_COLS)}) FROM STDIN") as cp:
                    for p in parties:
                        cp.write_row(p)
                cur.execute("UPDATE import_batch SET accident_rows=%s, party_rows=%s WHERE id=%s",
                            (len(accidents), len(parties), batch_id))
            conn.commit()
            total_acc += len(accidents)
            total_party += len(parties)
            print(f"  {path.name}：事故 {len(accidents):,} 件、當事人 {len(parties):,} 列")
        conn.execute("SELECT setval('accident_id_seq', %s)", (max(acc_id, 1),))
        conn.execute("ANALYZE accident")
        conn.execute("ANALYZE party")
        conn.commit()
    print(f"匯入完成：事故 {total_acc:,} 件、當事人 {total_party:,} 列（{time.time() - t0:.0f} 秒）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

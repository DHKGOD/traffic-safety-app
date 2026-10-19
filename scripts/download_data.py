"""自動下載交通事故開放資料到 data/raw/。

資料來源（政府資料開放平臺 data.gov.tw）：
- 13139 即時交通事故資料(A2類)：每月一個 zip，例如 115_NPA_TMA2_01.zip
- 12197 歷史交通事故資料(A1/A2)：每年度 CSV

用法：
    uv run python scripts/download_data.py                 # 下載 115 年 A2 全部月份
    uv run python scripts/download_data.py --with-a1       # 另外下載歷史資料中最新年度的 A1 類（死亡事故）
    uv run python scripts/download_data.py --force         # 重新下載已存在的檔案

已下載且大小相同的檔案會跳過。下載清單與 SHA-256 會寫進 data/raw/manifest.json。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import truststore

truststore.inject_into_ssl()  # 使用作業系統憑證庫（部分防毒軟體會攔截 TLS）

import httpx  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
API = "https://data.gov.tw/api/v2/rest/dataset/{id}"
DATASET_A2_REALTIME = 13139
DATASET_HISTORY = 12197


def list_resources(dataset_id: int) -> list[dict]:
    r = httpx.get(API.format(id=dataset_id), timeout=60)
    r.raise_for_status()
    return r.json()["result"]["distribution"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, force: bool) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=300, follow_redirects=True) as r:
        r.raise_for_status()
        size = int(r.headers.get("content-length") or 0)
        if dest.exists() and not force and size and dest.stat().st_size == size:
            print(f"  已存在，跳過：{dest.name}")
        else:
            tmp = dest.with_suffix(dest.suffix + ".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
            tmp.replace(dest)
            print(f"  完成：{dest.name}（{dest.stat().st_size / 1e6:.1f} MB）")
    return {"file": str(dest.relative_to(ROOT)).replace("\\", "/"), "url": url,
            "bytes": dest.stat().st_size, "sha256": sha256(dest)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, default=115, help="民國年（即時 A2 資料集），預設 115")
    ap.add_argument("--with-a1", action="store_true", help="另外下載歷史資料中最新年度的 A1 類")
    ap.add_argument("--force", action="store_true", help="重新下載已存在的檔案")
    args = ap.parse_args()

    manifest: list[dict] = []
    print(f"[A2 即時資料] 資料集 {DATASET_A2_REALTIME}，{args.year} 年")
    pat = re.compile(rf"^{args.year}_NPA_TMA2_(\d\d)\.zip$")
    items = []
    for d in list_resources(DATASET_A2_REALTIME):
        m = pat.match(d["resourceDescription"].strip())
        if m:
            items.append((int(m.group(1)), d))
    if not items:
        print("找不到任何月份檔案，請確認年份或資料集是否改版。", file=sys.stderr)
        return 1
    for month, d in sorted(items, key=lambda x: x[0]):
        name = d["resourceDescription"].strip()
        manifest.append(download(d["resourceDownloadUrl"], RAW / f"a2_{args.year}" / name, args.force)
                        | {"dataset": DATASET_A2_REALTIME, "kind": "A2", "year": args.year, "month": month})

    if args.with_a1:
        print(f"[歷史資料] 資料集 {DATASET_HISTORY}，A1 類最新年度")
        a1 = []
        for d in list_resources(DATASET_HISTORY):
            m = re.match(r"^(\d+)年度A1類", d["resourceDescription"].strip())
            if m:
                a1.append((int(m.group(1)), d))
        if a1:
            year, d = max(a1, key=lambda x: x[0])
            manifest.append(download(d["resourceDownloadUrl"], RAW / "a1_history" / f"{year}_A1.csv", args.force)
                            | {"dataset": DATASET_HISTORY, "kind": "A1", "year": year, "month": None})

    out = RAW / "manifest.json"
    out.write_text(json.dumps({"downloaded_at": datetime.now(timezone.utc).isoformat(), "files": manifest},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"共 {len(manifest)} 個檔案，清單寫入 {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

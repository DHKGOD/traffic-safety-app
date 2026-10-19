"""實機巡檢：透過 Chrome DevTools Protocol 在手機 App 裡自動點過每一頁、截圖、收集 JS 錯誤。

    uv run python scripts/phone_tour.py [輸出資料夾]

前置：手機接 USB、App 已開啟（debug 版 WebView 才能偵錯）、伺服器在執行。
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "logs" / "phone_tour"
PKG = "tw.edu.fju.trafficsafety"


def adb(*args: str) -> str:
    return subprocess.run(["adb", *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def screencap(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(OUT / f"{name}.png"))
    adb("shell", "rm", f"/sdcard/{name}.png")


STEPS: list[tuple[str, str, float]] = [
    # (截圖名稱, 要執行的 JS, 等待秒數)
    ("01_map", "document.querySelector('[data-tab=map]').click()", 4),
    ("02_weather_sheet", "document.querySelector('[data-act=weather]').click()", 1.2),
    ("03_rain_mode", "[...document.querySelectorAll('.as-btn')].find(b=>b.textContent.includes('雨天')).click()", 3),
    ("04_back_all", "document.querySelector('[data-act=weather]').click(); setTimeout(()=>[...document.querySelectorAll('.as-btn')].find(b=>b.textContent.includes('全部天候')).click(), 600)", 3),
    ("05_sheet_half", "document.querySelector('.sheet-grabber').click()", 1.5),
    ("06_report", "const c=document.querySelector('.hs-cell'); c.click(); setTimeout(()=>c.click(), 900)", 4),
    ("07_report_scroll", "document.querySelector('[data-root=map] .page:last-child .scroll').scrollTo(0, 900)", 1.5),
    ("08_back_map", "document.querySelector('[data-root=map] .page:last-child [data-back]').click()", 2),
    ("09_planner", "document.querySelector('[data-act=plan]').click()", 2),
    ("10_planner_close", "document.querySelector('.modal [data-close]').click()", 1.2),
    ("11_walk", "document.querySelector('.sheet-grabber').click(); document.querySelector('[data-act=walk]').click()", 3),
    ("12_walk_alert", "[...document.querySelectorAll('.walk-panel .segmented button')].find(b=>b.textContent.includes('30')).click()", 9),
    ("13_walk_stop", "document.querySelector('.walk-panel [data-w=stop]')?.click()", 1.5),
    ("14_rank", "document.querySelector('[data-tab=rank]').click()", 3),
    ("15_feed", "document.querySelector('[data-tab=feed]').click()", 2),
    ("16_submit", "document.querySelector('button[data-new]').click()", 3),
    ("17_submit_close", "document.querySelector('.modal [data-close]').click()", 1.2),
    ("18_settings", "document.querySelector('[data-tab=settings]').click()", 2.5),
    ("19_admin", "document.querySelector('[data-admin]').click()", 3),
    ("20_admin_back", "document.querySelector('[data-root=settings] .page:last-child [data-back]').click()", 1.5),
    ("21_family", "document.querySelector('[data-family]').click()", 2.5),
    ("22_family_back", "document.querySelector('[data-root=settings] .page:last-child [data-back]').click(); document.querySelector('[data-tab=map]').click()", 2),
]


async def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(3)
    sock = re.search(r"webview_devtools_remote_\d+", adb("shell", "cat", "/proc/net/unix"))
    if not sock:
        print("找不到 App 的 WebView 偵錯介面（App 有開嗎？是 debug 版嗎？）")
        return 1
    adb("forward", "tcp:9222", f"localabstract:{sock.group(0)}")
    page = next(t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")) if t["type"] == "page")
    errors: list[str] = []
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        msg_id = 0

        async def send(method: str, params: dict | None = None) -> dict:
            nonlocal msg_id
            msg_id += 1
            my = msg_id
            await ws.send(json.dumps({"id": my, "method": method, "params": params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("method") == "Runtime.exceptionThrown":
                    d = m["params"]["exceptionDetails"]
                    errors.append((d.get("exception") or {}).get("description") or d.get("text"))
                if m.get("id") == my:
                    return m

        await send("Runtime.enable")
        for name, js, wait in STEPS:
            res = await send("Runtime.evaluate", {"expression": js, "awaitPromise": False})
            exc = res.get("result", {}).get("exceptionDetails")
            if exc:
                errors.append(f"[{name}] 步驟失敗：{exc.get('exception', {}).get('description', exc.get('text'))}")
            end = time.time() + wait
            while time.time() < end:  # 等待期間持續收集錯誤
                try:
                    m = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time())))
                    if m.get("method") == "Runtime.exceptionThrown":
                        d = m["params"]["exceptionDetails"]
                        errors.append(f"[{name}] {(d.get('exception') or {}).get('description') or d.get('text')}")
                except asyncio.TimeoutError:
                    break
            screencap(name)
            print(f"  {name} ✓", flush=True)
    print(f"截圖：{OUT}")
    print(f"JS 錯誤：{len(errors)}")
    for e in errors:
        print("  -", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

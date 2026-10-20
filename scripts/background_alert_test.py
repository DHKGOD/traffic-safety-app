"""實機測試：背景守護模擬／導航護航時，切到其他 App 仍會跳出靈動島提醒與護航小圖示。

    uv run python scripts/background_alert_test.py [bg|nav] [秒數]

bg ：在設定頁按「背景守護模擬」，再按主畫面鍵回桌面。
nav：在設定頁按「導航護航模擬」，App 會自動打開 Google 地圖導航。
期間每 2 秒截圖，並從通知列確認有沒有送出危險路口提醒。截圖在 logs/background_test/。
前置：手機接 USB、已解鎖、App 已安裝、伺服器在執行。
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
OUT = ROOT / "logs" / "background_test"
PKG = "tw.edu.fju.trafficsafety"
KIND = sys.argv[1] if len(sys.argv) > 1 else "bg"
SECONDS = int(sys.argv[2]) if len(sys.argv) > 2 else 60


def adb(*args: str) -> str:
    return subprocess.run(["adb", *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def screencap(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(OUT / f"{name}.png"))
    adb("shell", "rm", f"/sdcard/{name}.png")


async def run_js(js: str) -> None:
    sock = re.search(r"webview_devtools_remote_\d+", adb("shell", "cat", "/proc/net/unix"))
    if not sock:
        raise SystemExit("找不到 App 的 WebView 偵錯介面（App 有開嗎？是 debug 版嗎？）")
    adb("forward", "tcp:9222", f"localabstract:{sock.group(0)}")
    page = next(t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")) if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js}}))
        while json.loads(await ws.recv()).get("id") != 1:
            pass


def alerts_posted() -> list[str]:
    """通知列上的危險路口提醒（每個路口一個群組 guardian_alert_<路口編號>）。"""
    dump = adb("shell", "dumpsys", "notification", "--noredact")
    return sorted(set(re.findall(r"groupKey=guardian_alert_(\d+)", dump)))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.png"):
        f.unlink()
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    time.sleep(1)
    if "isKeyguardShowing=true" in adb("shell", "dumpsys", "window"):
        print("手機目前鎖定中：請先解鎖")
        return 2
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(3)
    before = set(alerts_posted())
    asyncio.run(run_js(f"document.querySelector('[data-tab=settings]').click(); setTimeout(()=>document.querySelector('[data-dev={KIND}]').click(), 500)"))
    time.sleep(4)
    if KIND == "bg":
        adb("shell", "input", "keyevent", "KEYCODE_HOME")
    end = time.time() + SECONDS
    i = 0
    while time.time() < end:
        time.sleep(2)
        top = re.search(r"mCurrentFocus=Window\{\S+ \S+ ([^}/]+)", adb("shell", "dumpsys", "window"))
        screencap(f"{i:02d}")
        print(f"  {i:02d} 前景：{top.group(1) if top else '?'}", flush=True)
        i += 1
    new = [a for a in alerts_posted() if a not in before]
    print(f"截圖：{OUT}")
    print(f"期間送出的危險路口提醒：{len(new)} 個路口（編號 {', '.join(new) or '無'}）")
    return 0 if new else 1


if __name__ == "__main__":
    sys.exit(main())

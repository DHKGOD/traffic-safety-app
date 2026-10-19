"""實機測試背景守護：在 App 內開始「沿路線模擬」→ 按主畫面鍵離開 App → 錄影 → 檢查提醒通知 → 擷取影格。

    uv run python scripts/guardian_device_test.py [秒數]

前置：手機接 USB、App 已安裝（debug 版）、伺服器在執行、adb reverse tcp:8000 tcp:8000。
結果：logs/guardian_test/ 底下的影格圖片；終端機列出收到的提醒通知。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "guardian_test"
PKG = "tw.edu.fju.trafficsafety"
SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 40
FFMPEG = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright" / "ffmpeg-1013" / "ffmpeg-win64.exe"
# 沿 Demo 路線（輔大 → 新莊捷運站）
ROUTE = json.loads((ROOT / "frontend" / "src" / "data" / "demo-route.json").read_text(encoding="utf-8"))["points"]


def adb(*a: str, timeout: int = 60) -> str:
    return subprocess.run(["adb", *a], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout).stdout


async def cdp(expr: str):
    return await asyncio.wait_for(_cdp(expr), 30)


async def _cdp(expr: str):
    sock = re.search(r"webview_devtools_remote_\d+", adb("shell", "cat", "/proc/net/unix"))
    adb("forward", "tcp:9222", f"localabstract:{sock.group(0)}")
    page = next(t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")) if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                  "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == 1:
                return m["result"]


def alerts() -> list[str]:
    out = adb("shell", "dumpsys notification --noredact")
    return sorted(set(re.findall(r"android\.title=String \((⚠ [^)]*)\)", out)))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*"):
        f.unlink()
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(3)
    res = asyncio.run(cdp(f"""(async()=>{{
        const G = window.Capacitor.Plugins.Guardian;
        await G.stop();
        return await G.start({{server: localStorage.getItem('serverUrl'), mode: 'auto', simulate: {json.dumps(ROUTE)}, simSpeed: 25}});
    }})()"""))
    print("啟動：", res.get("result", {}).get("value"))
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(1.5)
    # 連續截圖；以第一張（桌面）為基準，畫面上方明顯改變的就是彈出的提醒橫幅
    from PIL import Image, ImageChops, ImageStat
    base = None
    banners = []
    end = time.time() + SECONDS
    i = 0
    while time.time() < end:
        png = subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=20).stdout
        path = OUT / f"shot_{i:03d}.png"
        path.write_bytes(png)
        try:
            img = Image.open(path).convert("RGB")
        except OSError:  # 畫面切換瞬間偶爾會拿到不完整的截圖，略過
            path.unlink(missing_ok=True)
            i += 1
            continue
        top = img.crop((0, 90, img.width, 600))
        if base is None:
            base = top
        else:
            diff = ImageStat.Stat(ImageChops.difference(top, base)).mean
            if sum(diff) / 3 > 18:
                banners.append(path.name)
                img.resize((img.width // 2, img.height // 2)).save(OUT / f"banner_{i:03d}.png")
        if path.name not in banners and i > 0:
            path.unlink()
        i += 1
    got = alerts()
    # 背景中的 WebView 會暫停，先把 App 帶回前景再停止服務
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(2)
    asyncio.run(asyncio.wait_for(cdp("window.Capacitor.Plugins.Guardian.stop()"), 15))
    print(f"{SECONDS} 秒內收到的提醒：{len(got)}；截圖 {i} 張，偵測到橫幅 {len(banners)} 張")
    for a in got:
        print("  ", a)
    print(f"橫幅截圖：{OUT}")
    return 0 if got and banners else 1


if __name__ == "__main__":
    sys.exit(main())

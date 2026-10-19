"""驗證 .mcp.json 裡的每個 MCP server 能啟動並回應（initialize → tools/list，postgres 另外實際查一次 SQL）。

    uv run python scripts/verify_mcp.py
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rpc(proc: subprocess.Popen, q: queue.Queue, msg_id: int, method: str, params: dict, timeout: float = 120):
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}) + "\n")
    proc.stdin.flush()
    while True:
        line = q.get(timeout=timeout)
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == msg_id:
            return msg


def check(name: str, cfg: dict) -> tuple[bool, str]:
    env = {**os.environ, **cfg.get("env", {})}
    proc = subprocess.Popen([cfg["command"], *cfg.get("args", [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding="utf-8", env=env, cwd=ROOT)
    q: queue.Queue = queue.Queue()
    threading.Thread(target=lambda: [q.put(l) for l in proc.stdout], daemon=True).start()
    try:
        rpc(proc, q, 1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                      "clientInfo": {"name": "verify_mcp", "version": "1"}})
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        proc.stdin.flush()
        tools = [t["name"] for t in rpc(proc, q, 2, "tools/list", {})["result"]["tools"]]
        detail = f"{len(tools)} 個工具：{', '.join(tools[:6])}{'…' if len(tools) > 6 else ''}"
        if name == "postgres":
            res = rpc(proc, q, 3, "tools/call", {"name": "execute_sql",
                                                 "arguments": {"sql": "SELECT count(*) AS accidents FROM accident"}})
            text = res.get("result", {}).get("content", [{}])[0].get("text", "")
            detail += f"\n      實際查詢 SELECT count(*) FROM accident → {text.strip()[:80]}"
        return True, detail
    except Exception as e:  # noqa: BLE001
        return False, f"失敗：{e!r}"
    finally:
        proc.kill()


def main() -> int:
    servers = json.loads((ROOT / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"]
    ok_all = True
    for name, cfg in servers.items():
        ok, detail = check(name, cfg)
        ok_all &= ok
        print(f"[{'OK' if ok else 'NG'}] {name}：{detail}", flush=True)
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())

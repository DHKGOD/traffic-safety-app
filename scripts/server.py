"""一鍵啟動／停止：資料庫（local 模式）＋ FastAPI。由 start_server.bat / stop_server.bat（或 .sh）呼叫。

    uv run python scripts/server.py start
    uv run python scripts/server.py stop
    uv run python scripts/server.py status
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, database_url, env, lan_ips  # noqa: E402

RUN = ROOT / "run"
LOGS = ROOT / "logs"
PID = RUN / "api.pid"
API_LOG = LOGS / "api.log"


def py(script: str, *args: str) -> None:
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / script), *args], cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"{script} 失敗")


def pid_alive(pid: int) -> bool:
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace").stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def api_pid() -> int | None:
    if PID.exists():
        try:
            pid = int(PID.read_text().strip())
            if pid_alive(pid):
                return pid
        except ValueError:
            pass
        PID.unlink(missing_ok=True)
    return None


def ensure_database() -> None:
    """local 模式：啟動資料庫；並檢查每個初始化步驟是否完成，沒完成的自動補做（中途失敗的下次啟動會接著做）。"""
    if env("DB_MODE", "local") == "local":
        py("localdb.py", "start")
        py("db_bootstrap.py")
    py("migrate.py")
    raw = sorted((ROOT / "data" / "raw" / "a2_115").glob("*.zip"))
    with psycopg.connect(database_url()) as conn:
        batches = conn.execute("SELECT count(*) FROM import_batch WHERE accident_rows > 0").fetchone()[0]
        flagged = conn.execute("SELECT count(*) FROM accident WHERE coord_flag IS NOT NULL").fetchone()[0]
        hotspots = conn.execute("SELECT count(*) FROM hotspot").fetchone()[0]
        models = conn.execute("SELECT artifact_path FROM model_version WHERE is_active AND name = 'cause_scenario'").fetchall()
    imported = batches > 0 and (not raw or batches >= len(raw))
    if not imported:
        print("資料庫還沒有完整的事故資料，開始匯入（約 1–2 分鐘）…")
        if not raw:
            py("download_data.py")
        py("import_accidents.py")
    if not imported or flagged == 0:
        py("clean_coords.py")
    if not imported or flagged == 0 or hotspots == 0:
        py("build_hotspots.py")
    if not models or not (ROOT / models[0][0]).exists():
        print("沒有可用的 AI 模型，開始訓練（約 2–3 分鐘）…")
        r = subprocess.run([sys.executable, str(ROOT / "ai" / "train_cause_model.py")], cwd=ROOT)
        if r.returncode != 0:
            print("⚠ AI 模型訓練失敗：伺服器仍會啟動，但 AI 預測暫時無法使用（之後可手動執行 ai/train_cause_model.py）")


def ensure_frontend() -> None:
    """後端也提供網頁版前端：frontend/dist 不存在時自動建置（需要 Node.js）。"""
    if (ROOT / "frontend" / "dist" / "index.html").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        print("⚠ 找不到 Node.js（npm），無法建置網頁版前端；API 仍可使用，App 不受影響。")
        return
    print("建置網頁版前端…")
    front = ROOT / "frontend"
    if not (front / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=front, check=False)
    if subprocess.run([npm, "run", "build"], cwd=front).returncode != 0:
        print("⚠ 前端建置失敗；API 仍可使用。")


def start() -> None:
    py("setup_env.py")
    ensure_database()
    ensure_frontend()
    port = env("API_PORT", "8000")
    host = env("API_HOST", "0.0.0.0")
    if api_pid():
        print("API 已在執行中。")
    else:
        RUN.mkdir(exist_ok=True)
        LOGS.mkdir(exist_ok=True)
        log = API_LOG.open("a", encoding="utf-8")
        cmd = [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", host, "--port", port,
               "--proxy-headers"]
        kw: dict = {"cwd": ROOT, "stdout": log, "stderr": subprocess.STDOUT, "stdin": subprocess.DEVNULL}
        if os.name == "nt":
            kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        else:
            kw["start_new_session"] = True
        p = subprocess.Popen(cmd, **kw)
        PID.write_text(str(p.pid))
        for _ in range(60):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2).json().get("status") == "ok":
                    break
            except Exception:  # noqa: BLE001
                pass
            if p.poll() is not None:
                raise SystemExit(f"API 啟動失敗，請看 {API_LOG.relative_to(ROOT)}")
            time.sleep(0.5)
        else:
            raise SystemExit("API 30 秒內沒有回應，請看 logs/api.log")
    public = env("PUBLIC_API_BASE", "")
    print("\n" + "=" * 60)
    print("  伺服器已啟動（資料庫＋API）")
    print(f"  本機瀏覽器：http://127.0.0.1:{port}/")
    for ip in lan_ips():
        print(f"  手機／平板（同一個 Wi-Fi）請在 App 設定頁輸入：http://{ip}:{port}")
    if public:
        print(f"  對外網址：{public}")
    print(f"  API 文件：http://127.0.0.1:{port}/docs")
    print("  停止：執行 stop_server.bat（或 ./stop_server.sh）")
    print("=" * 60)


def stop() -> None:
    pid = api_pid()
    if pid:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(pid, signal.SIGTERM)
        PID.unlink(missing_ok=True)
        print("API 已停止。")
    else:
        print("API 沒有在執行。")
    if env("DB_MODE", "local") == "local":
        py("localdb.py", "stop")


def status() -> None:
    pid = api_pid()
    print(f"API：{'執行中（PID ' + str(pid) + '）' if pid else '未執行'}")
    if env("DB_MODE", "local") == "local":
        py("localdb.py", "status")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"start": start, "stop": stop, "status": status}.get(cmd, lambda: print(__doc__))()
    return 0


if __name__ == "__main__":
    sys.exit(main())

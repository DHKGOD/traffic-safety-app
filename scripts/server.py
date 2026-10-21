"""一鍵啟動／停止：資料庫（local 模式）＋ FastAPI。

    uv run python scripts/server.py run      # start_server.bat 用：在這個視窗執行，關掉視窗就停止
    uv run python scripts/server.py start    # 背景執行（自動化測試用）
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
        rain_rows = conn.execute("SELECT count(*) FROM hotspot_rain_risk").fetchone()[0]
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
    # AI 任務 2：雨天校正需要氣象署授權碼（或已下載的快取）；沒有就略過，報告退回天候欄判斷
    cached = (ROOT / "data" / "raw" / "cwa" / "C-B0025-001.json").exists()
    if rain_rows == 0 and (env("CWA_API_KEY", "").strip() or cached):
        print("計算雨天風險校正（氣象署測站雨量，約 1 分鐘）…")
        args = [] if env("CWA_API_KEY", "").strip() else ["--offline"]
        r = subprocess.run([sys.executable, str(ROOT / "ai" / "rain_risk.py"), *args], cwd=ROOT)
        if r.returncode != 0:
            print("⚠ 雨天風險校正失敗：伺服器仍會啟動，路口報告改用天候欄判斷（之後可手動執行 ai/rain_risk.py）")


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


def step(text: str) -> None:
    """步驟標題：每一步開始前先印出來，畫面才不會長時間空白像當掉（使用者回饋）。"""
    print(text, flush=True)


def api_command(host: str, port: str) -> list[str]:
    cmd = [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", host, "--port", port, "--proxy-headers"]
    if os.name == "nt":
        # Python 3.11 Proactor 的 accept 遇到 WinError 64 會關閉監聽 socket，
        # 程序仍活著但所有新連線被拒絕。只為 Windows 本機 API 指定 Selector。
        cmd += ["--loop", "backend.app.runtime:windows_selector_loop"]
    return cmd


def wait_healthy(p: subprocess.Popen, port: str, log_hint: str) -> None:
    for _ in range(60):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2).json().get("status") == "ok":
                return
        except Exception:  # noqa: BLE001
            pass
        if p.poll() is not None:
            raise SystemExit(f"API 啟動失敗，請看 {log_hint}")
        time.sleep(0.5)
    raise SystemExit(f"API 30 秒內沒有回應，請看 {log_hint}")


def banner(port: str, foreground: bool) -> None:
    public = env("PUBLIC_API_BASE", "")
    print("\n" + "=" * 60)
    if foreground:
        print("  ✅ 完成！伺服器執行中（資料庫＋API）")
        print("  ★ 要停止伺服器：直接關掉這個視窗（或按 Ctrl+C）")
    else:
        print("  ✅ 完成！伺服器已在背景啟動（資料庫＋API）")
        print("  停止：uv run python scripts/server.py stop")
    print(f"  本機瀏覽器：http://127.0.0.1:{port}/")
    for ip in lan_ips():
        print(f"  手機／平板（同一個 Wi-Fi）請在 App 設定頁輸入：http://{ip}:{port}")
    if public:
        print(f"  對外網址：{public}")
    print(f"  API 文件：http://127.0.0.1:{port}/docs")
    print("=" * 60, flush=True)


def on_console_close(cleanup) -> None:
    """Windows：關掉視窗（CTRL_CLOSE_EVENT）、登出、關機時也執行 cleanup。
    Python 的 signal 收不到關視窗事件，要用 SetConsoleCtrlHandler；系統約給 5 秒。"""
    if os.name != "nt":
        signal.signal(signal.SIGTERM, lambda *_: cleanup())
        signal.signal(signal.SIGHUP, lambda *_: cleanup())
        return
    import ctypes
    from ctypes import wintypes

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
    def handler(event: int) -> bool:
        if event in (2, 5, 6):  # CTRL_CLOSE_EVENT、CTRL_LOGOFF_EVENT、CTRL_SHUTDOWN_EVENT
            cleanup()
            return True
        return False  # Ctrl+C／Ctrl+Break 交給 Python 的 KeyboardInterrupt

    on_console_close.handler = handler  # 保留參照，避免被回收
    ctypes.windll.kernel32.SetConsoleCtrlHandler(handler, True)


def start_watchdog() -> None:
    """另開一個不屬於這個視窗的背景程序，等這個程序結束（關視窗、被強制結束都算）就停止 API 與資料庫。
    關視窗事件在 Windows Terminal 等情況不一定送得到，看門狗是保險。"""
    kw: dict = {"cwd": ROOT, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
                               | 0x01000000)  # CREATE_BREAKAWAY_FROM_JOB：Windows Terminal 關分頁時不會一起被結束
    else:
        kw["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "watchdog", str(os.getpid())], **kw)
    except OSError:  # 不允許脫離工作物件時，改用一般背景程序
        kw["creationflags"] &= ~0x01000000
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "watchdog", str(os.getpid())], **kw)


def watchdog(pid: int) -> None:
    """等 pid 結束，再停止 API 與資料庫（只在 start_server 的視窗程序結束後才動作）。"""
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if h:
            k32.WaitForSingleObject(h, 0xFFFFFFFF)
            k32.CloseHandle(h)
    else:
        while pid_alive(pid):
            time.sleep(1)
    stop_api()
    if env("DB_MODE", "local") == "local":
        subprocess.run([sys.executable, str(ROOT / "scripts" / "localdb.py"), "stop"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def start(foreground: bool = False) -> None:
    """foreground=True（start_server.bat 用）：API 在這個視窗執行，關掉視窗就停止 API 與資料庫。
    foreground=False（自動化測試用）：API 在背景執行，要用 stop 停止。"""
    step("[2/4] 設定檔與資料庫…")
    py("setup_env.py")
    ensure_database()
    step("[3/4] 網頁前端…")
    ensure_frontend()
    port = env("API_PORT", "8000")
    host = env("API_HOST", "0.0.0.0")
    step("[4/4] 啟動 API（最多 30 秒）…")
    RUN.mkdir(exist_ok=True)
    LOGS.mkdir(exist_ok=True)
    if not foreground:
        if api_pid():
            print("API 已在執行中。")
        else:
            log = API_LOG.open("a", encoding="utf-8")
            kw: dict = {"cwd": ROOT, "stdout": log, "stderr": subprocess.STDOUT, "stdin": subprocess.DEVNULL}
            if os.name == "nt":
                kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
            else:
                kw["start_new_session"] = True
            p = subprocess.Popen(api_command(host, port), **kw)
            PID.write_text(str(p.pid))
            wait_healthy(p, port, str(API_LOG.relative_to(ROOT)))
        banner(port, False)
        return
    if api_pid():  # 之前在背景啟動的 API 先停掉，改由這個視窗管理
        stop_api()
    p = subprocess.Popen(api_command(host, port), cwd=ROOT, stdin=subprocess.DEVNULL)
    PID.write_text(str(p.pid))
    done = False

    def cleanup() -> None:
        nonlocal done
        if done:
            return
        done = True
        print("\n正在停止伺服器…", flush=True)
        if p.poll() is None:
            p.terminate()
        PID.unlink(missing_ok=True)
        if env("DB_MODE", "local") == "local":
            subprocess.run([sys.executable, str(ROOT / "scripts" / "localdb.py"), "stop"], cwd=ROOT)

    on_console_close(cleanup)
    start_watchdog()
    try:
        wait_healthy(p, port, "上方訊息")
        banner(port, True)
        p.wait()
        print("⚠ API 已結束（請看上方訊息）")
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


def stop_api() -> None:
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


def stop() -> None:
    stop_api()
    if env("DB_MODE", "local") == "local":
        py("localdb.py", "stop")


def status() -> None:
    pid = api_pid()
    print(f"API：{'執行中（PID ' + str(pid) + '）' if pid else '未執行'}")
    if env("DB_MODE", "local") == "local":
        py("localdb.py", "status")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "watchdog":
        watchdog(int(sys.argv[2]))
        return 0
    {"start": start, "run": lambda: start(foreground=True), "stop": stop,
     "status": status}.get(cmd, lambda: print(__doc__))()
    return 0


if __name__ == "__main__":
    sys.exit(main())

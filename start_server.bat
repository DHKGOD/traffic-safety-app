@echo off
rem 一鍵啟動：資料庫（專案內 db\pgdata）＋ FastAPI，並顯示手機要連的區網網址
rem 伺服器在這個視窗執行：要停止就直接關掉這個視窗（或按 Ctrl+C）。
rem 注意：括號區塊裡只能寫英文；cmd 在 UTF-8 下解析中文會切錯，變成奇怪的指令。
chcp 65001 >nul
title 有路安 伺服器
cd /d "%~dp0"
set UV_SYSTEM_CERTS=1
set PYTHONIOENCODING=utf-8
rem 訊息立刻顯示（不要等整段跑完才出現，否則看起來像當掉）
set PYTHONUNBUFFERED=1
rem Python 放在專案內 .uv-python：Claude 桌面版等 Store App 寫在 AppData 的檔案別的程式看不到，
rem 若 .venv 指向那裡，從檔案總管執行時 uv 會以為 .venv 壞了而刪掉重建（2026-10-21 實際發生）。
set UV_PYTHON_INSTALL_DIR=%~dp0.uv-python
set UV_PYTHON_PREFERENCE=only-managed
echo ============================================================
echo   有路安 伺服器啟動中…（第一次啟動可能需要幾分鐘）
echo ============================================================
where uv >nul 2>nul
if errorlevel 1 goto no_uv
echo [1/4] 檢查 Python 套件…
rem 套件都在就不跑 uv sync；只有第一次或缺套件時才安裝，過程記在 logs\uv_sync.log
if not exist ".venv\Scripts\python.exe" goto sync
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, psycopg, sklearn, httpx, anyio, click" >nul 2>nul
if errorlevel 1 goto sync
goto run

:sync
echo 安裝 Python 套件（第一次約 1–2 分鐘）…
if not exist logs mkdir logs
uv sync -v > logs\uv_sync.log 2>&1
if errorlevel 1 goto sync_failed

:run
uv run --no-sync python scripts\server.py run
echo.
echo 伺服器已停止。
pause
exit /b 0

:no_uv
echo 找不到 uv，請先安裝：https://docs.astral.sh/uv/
pause
exit /b 1

:sync_failed
echo ⚠ Python 套件安裝失敗，詳細訊息在 logs\uv_sync.log
echo   請先關掉其他用到本專案 Python 的程式（例如還在跑的伺服器）再試一次
pause
exit /b 1

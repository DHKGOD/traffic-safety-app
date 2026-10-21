@echo off
rem 一鍵啟動：資料庫（專案內 db\pgdata）＋ FastAPI，並顯示手機要連的區網網址
chcp 65001 >nul
title 有路安 伺服器
cd /d "%~dp0"
set UV_SYSTEM_CERTS=1
set PYTHONIOENCODING=utf-8
rem 訊息立刻顯示（不要等整段跑完才出現，否則看起來像當掉）
set PYTHONUNBUFFERED=1
echo ============================================================
echo   有路安 伺服器啟動中…（第一次啟動可能需要幾分鐘）
echo ============================================================
where uv >nul 2>nul
if errorlevel 1 (
  echo 找不到 uv，請先安裝：https://docs.astral.sh/uv/
  pause
  exit /b 1
)
echo [1/4] 檢查 Python 套件…
rem 套件都在就不跑 uv sync：.venv 若正被其他程式使用（例如 Claude 的資料庫工具），
rem uv sync 可能想重建 .venv 而刪掉一半套件（2026-10-21 實際發生）。只有第一次或缺套件時才安裝。
rem 注意：括號區塊裡不要寫中文 rem，cmd 在 UTF-8 下會解析錯。
set NEED_SYNC=1
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import fastapi, uvicorn, psycopg, sklearn, httpx, anyio, click" >nul 2>nul
  if not errorlevel 1 set NEED_SYNC=0
)
if "%NEED_SYNC%"=="1" (
  echo 安裝 Python 套件（第一次約 1 分鐘）…
  if not exist logs mkdir logs
  uv sync -v > logs\uv_sync.log 2>&1
  if errorlevel 1 (
    echo ⚠ Python 套件安裝失敗，詳細訊息在 logs\uv_sync.log
    echo   請先關掉其他用到本專案 Python 的程式（例如 Claude、還在跑的伺服器）再試一次
    pause
    exit /b 1
  )
)
uv run --no-sync python scripts\server.py start
echo.
pause

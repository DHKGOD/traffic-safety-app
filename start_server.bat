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
set SYNC=
uv sync --quiet
if errorlevel 1 (
  rem 常見原因：.venv 正被其他程式使用（例如 Claude 的資料庫工具、還在跑的 API），Windows 不讓 uv 改檔案。
  rem 現有環境的必要套件都在就照常啟動，不在才停下來。
  uv run --no-sync python -c "import fastapi, uvicorn, psycopg, sklearn, httpx" >nul 2>nul
  if errorlevel 1 (
    echo ⚠ Python 套件安裝失敗，請看上方訊息（關掉其他用到本專案 Python 的程式後再試一次）
    pause
    exit /b 1
  )
  echo ⚠ 套件更新沒有完成（.venv 可能正被其他程式使用），先用現有的套件啟動
  set SYNC=--no-sync
)
uv run %SYNC% python scripts\server.py start
echo.
pause

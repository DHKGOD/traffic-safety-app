@echo off
rem 一鍵啟動：資料庫（專案內 db\pgdata）＋ FastAPI，並顯示手機要連的區網網址
chcp 65001 >nul
cd /d "%~dp0"
set UV_SYSTEM_CERTS=1
set PYTHONIOENCODING=utf-8
where uv >nul 2>nul
if errorlevel 1 (
  echo 找不到 uv，請先安裝：https://docs.astral.sh/uv/
  pause
  exit /b 1
)
uv sync --quiet
uv run python scripts\server.py start
echo.
pause

@echo off
rem 一鍵停止：FastAPI ＋ 資料庫
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
uv run python scripts\server.py stop
echo.
pause

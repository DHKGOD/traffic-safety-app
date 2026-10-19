#!/usr/bin/env bash
# 一鍵啟動（Linux / macOS / 雲端主機）：資料庫（DB_MODE=local 時）＋ FastAPI
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONIOENCODING=utf-8
command -v uv >/dev/null || { echo "找不到 uv，請先安裝：curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
uv sync --quiet
uv run python scripts/server.py start

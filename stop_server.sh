#!/usr/bin/env bash
# 一鍵停止（Linux / macOS / 雲端主機）
set -euo pipefail
cd "$(dirname "$0")"
uv run python scripts/server.py stop

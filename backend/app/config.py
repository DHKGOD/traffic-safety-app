"""後端設定：全部從環境變數／.env 讀取，換主機只改 .env。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _path(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else ROOT / p


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()])
    public_api_base: str = field(default_factory=lambda: os.environ.get("PUBLIC_API_BASE", ""))
    model_dir: Path = field(default_factory=lambda: _path(os.environ.get("MODEL_DIR", "ai/models")))
    frontend_dir: Path = field(default_factory=lambda: _path(os.environ.get("FRONTEND_DIR", "frontend/dist")))
    # 中央氣象署開放資料授權碼（沒有時雨天自動模式隱藏）
    cwa_api_key: str = field(default_factory=lambda: os.environ.get("CWA_API_KEY", "").strip())
    # 測試用：強制不用 PostGIS，驗證替代查詢
    force_no_postgis: bool = field(default_factory=lambda: os.environ.get("FORCE_NO_POSTGIS", "") == "1")


settings = Settings()

DISCLAIMER = "依官方歷史事故統計提醒注意，不保證路況安全"
DATA_SOURCE = "內政部警政署 即時交通事故資料(A2類) 115 年（政府資料開放平臺 data.gov.tw/dataset/13139）"

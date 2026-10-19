"""AI 介面（預留；模型訓練完成後由 ai/train_cause_model.py 寫入 model_version 並存檔）。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..db import db

router = APIRouter(prefix="/api/ai", tags=["AI"])

MODELS: dict[str, Any] = {}


def load_models() -> None:
    """啟動時載入 model_version 中 is_active 的模型（尚未訓練時略過）。"""
    MODELS.clear()


@router.get("/models", summary="模型版本與測試結果")
def models() -> list[dict[str, Any]]:
    with db.conn() as c:
        return c.execute("""SELECT id, name, version, task, algorithm, trained_at, train_range, test_range,
                                   metrics, baseline, is_active
                            FROM model_version ORDER BY trained_at DESC""").fetchall()

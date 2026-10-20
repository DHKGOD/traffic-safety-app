"""AI：肇因情境預測。模型由 ai/train_cause_model.py 訓練並登記在 model_version；每次預測寫入 prediction（可回查模型版本）。"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Literal

import joblib
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from psycopg.types.json import Jsonb

from ..config import ROOT
from ..db import db
from ..filters import Period, Weather

router = APIRouter(prefix="/api/ai", tags=["AI"])

ACTIVE_TASK = "cause_scenario"
MODELS: dict[str, dict[str, Any]] = {}

sys.path.insert(0, str(ROOT / "ai"))
from train_cause_model import age_band, hour_band, speed_band  # noqa: E402  共用同一套特徵定義

VEHICLE = {"scooter": "機車", "car": "小客車(含客、貨兩用)", "bike": "慢車"}
VEHICLE_LABEL = {"scooter": "騎機車", "car": "開汽車", "bike": "騎自行車"}
PERIOD_HOUR = {Period.morning: 8, Period.day: 13, Period.evening: 18, Period.night: 21}
AGE = {"young": 20, "adult": 35, "middle": 55, "senior": 70}
AGE_LABEL = {"young": "18–24 歲", "adult": "25–44 歲", "middle": "45–64 歲", "senior": "65 歲以上"}

# 各肇因給用路人的一句提醒（App 顯示用）
TIPS = {
    "未保持行車安全距離": "保持安全距離，前車急煞也停得住",
    "恍神、緊張、心不在焉分心駕駛": "專心看路，接近路口別看手機",
    "有號誌路口，轉彎車未讓直行車先行": "轉彎前讓直行車與行人先走",
    "左轉彎未依規定": "左轉依標誌，機車走兩段式",
    "無號誌路口，支線道未讓幹線道先行": "從小路出來要停車再開",
    "起步時未注意安全": "起步前確認左右與後方來車",
    "其他未依規定讓車": "路口多一秒禮讓",
    "未保持行車安全間隔": "與旁車保持左右間隔，不鑽車縫",
    "無號誌路口，轉彎車未讓直行車先行": "無號誌路口轉彎前先讓直行",
    "右轉彎未依規定": "右轉前打方向燈、注意右側機車與行人",
    "闖紅燈直行": "黃燈就減速，不搶紅燈",
    "迴轉未依規定": "迴轉前確認來車，避免在路口迴轉",
}


def load_models() -> None:
    """啟動時載入 model_version 中 is_active 的模型（尚未訓練時略過）。"""
    MODELS.clear()
    try:
        with db.conn() as c:
            rows = c.execute("""SELECT id, name, version, algorithm, metrics, baseline, artifact_path, train_range, test_range
                                FROM model_version WHERE is_active AND artifact_path IS NOT NULL""").fetchall()
    except Exception:  # noqa: BLE001  資料表不存在等情況
        return
    for r in rows:
        path = ROOT / r["artifact_path"]
        if path.exists():
            MODELS[r["name"]] = {"meta": r, **joblib.load(path)}


def _mode(c, sql: str, hid: int) -> Any:
    row = c.execute(sql, {"id": hid}).fetchone()
    return row["v"] if row else None


def _hotspot_profile(c, hid: int) -> dict[str, Any]:
    """路口的固定條件：取該路口歷史事故中最常見的值。"""
    q = "SELECT mode() WITHIN GROUP (ORDER BY {col}) AS v FROM accident WHERE hotspot_id = %(id)s"
    cols = ["weather", "light", "road_class", "speed_limit", "road_type_major", "road_type_minor", "position_major",
            "signal_type", "divider_major", "lane_fast_slow", "hour"]
    return {col: _mode(c, q.format(col=col), hid) for col in cols}


@router.get("/models", summary="模型版本與測試結果")
def models() -> list[dict[str, Any]]:
    with db.conn() as c:
        return c.execute("""SELECT id, name, version, task, algorithm, trained_at, train_range, test_range,
                                   metrics, baseline, is_active
                            FROM model_version ORDER BY trained_at DESC""").fetchall()


@router.get("/hotspots/{hotspot_id}/causes", summary="AI 肇因情境預測（每次預測都記錄模型版本）")
def predict_causes(hotspot_id: int, weather: Weather = Weather.all, period: Period = Period.all,
                   vehicle: Literal["scooter", "car", "bike"] = "scooter",
                   age: Literal["young", "adult", "middle", "senior"] = "adult",
                   top: int = Query(5, ge=1, le=10)) -> dict[str, Any]:
    m = MODELS.get(ACTIVE_TASK)
    if not m:
        raise HTTPException(503, "AI 模型尚未訓練（執行 uv run python ai/train_cause_model.py）")
    with db.conn() as c:
        if not c.execute("SELECT 1 FROM hotspot WHERE id = %(id)s", {"id": hotspot_id}).fetchone():
            raise HTTPException(404, "找不到這個路口")
        prof = _hotspot_profile(c, hotspot_id)
        w = {"rain": "雨", "clear": "晴"}.get(weather.value, prof["weather"] or "晴")
        hour = PERIOD_HOUR.get(period, prof["hour"] if prof["hour"] is not None else 8)
        night = hour >= 18 or hour < 6
        row = {
            "hour_band": hour_band(hour), "weekday_type": "平日", "weather": w,
            "light": "有照明且開啟" if night else "有照明未開啟或故障",  # 原始資料中白天多為「未開啟」
            "road_class": prof["road_class"] or "市區道路", "speed_band": speed_band(prof["speed_limit"]),
            "road_type_major": prof["road_type_major"] or "交岔路", "road_type_minor": prof["road_type_minor"] or "四岔路",
            "position_major": prof["position_major"] or "交叉路口", "surface_state": "濕潤" if w == "雨" else "乾燥",
            "signal_type": prof["signal_type"] or "無號誌", "divider_major": prof["divider_major"] or "無",
            "lane_fast_slow": prof["lane_fast_slow"] or "未繪設快慢車道分隔線",
            "v1": VEHICLE[vehicle], "age_band": age_band(AGE[age]), "sex1": "男",
        }
        X = pd.DataFrame([row])[m["features"]]
        proba = m["model"].predict_proba(X)[0]
        ranked = sorted(zip(m["classes"], proba), key=lambda kv: -kv[1])[:top]
        preds = [{"cause": c_, "probability": round(float(p), 4), "tip": TIPS.get(c_, "")} for c_, p in ranked]
        meta = m["meta"]
        scenario = {"weather": weather.value, "period": period.value, "vehicle": vehicle, "age": age}
        pid = c.execute("""INSERT INTO prediction (model_version_id, hotspot_id, input, output)
                           VALUES (%s, %s, %s, %s) RETURNING id""",
                        (meta["id"], hotspot_id, Jsonb({"scenario": scenario, "features": row}),
                         Jsonb({"top": preds}))).fetchone()["id"]
    return {
        "prediction_id": pid,
        "scenario": scenario | {"label": f"{'雨天' if w == '雨' else '晴天'}・{hour_band(hour)[:2]}・{VEHICLE_LABEL[vehicle]}・{AGE_LABEL[age]}"},
        "predictions": preds,
        "model": {"id": meta["id"], "name": meta["name"], "version": meta["version"], "algorithm": meta["algorithm"],
                  "metrics": {k: meta["metrics"].get(k) for k in ("accuracy", "macro_f1", "top3_accuracy")},
                  "baseline": {k: meta["baseline"].get(k) for k in ("accuracy", "macro_f1", "top3_accuracy")},
                  "test_range": meta["test_range"]},
    }


@router.get("/predictions/{prediction_id}", summary="回查某次預測與當時的模型版本")
def get_prediction(prediction_id: int) -> dict[str, Any]:
    with db.conn() as c:
        r = c.execute("""SELECT p.id, p.created_at, p.hotspot_id, p.input, p.output,
                                m.name AS model_name, m.version AS model_version, m.algorithm, m.metrics
                         FROM prediction p JOIN model_version m ON m.id = p.model_version_id
                         WHERE p.id = %(id)s""", {"id": prediction_id}).fetchone()
    if not r:
        raise HTTPException(404, "找不到這筆預測")
    return r


"""AI 肇因預測：依時間切分訓練與測試，並和「永遠猜最常見肇因」基準比較；結果寫入 model_version。

    uv run python ai/train_cause_model.py            # 訓練、評估、存檔、寫入資料庫（設為使用中）
    uv run python ai/train_cause_model.py --no-db    # 只訓練與評估

兩個模型（同一套程式）：
  A. cause_full      ：前 10 大主要肇因（全部類別），特徵含事故型態 → 與先前實測（acc 0.544）對照用
  B. cause_scenario  ：前 10 大「具體」肇因（排除「其他不當駕車行為」「尚未發現肇事因素」），
                       只用事故發生前就知道的特徵（天候、光線、時段、路口條件、用路人）→ App 情境預測使用

時間切分：1–6 月訓練、7–8 月驗證（選模型與超參數）、9–10 月最終測試（只評估一次）。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psycopg
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score, top_k_accuracy_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from common import database_url, env, project_path  # noqa: E402

MODEL_DIR = project_path(env("MODEL_DIR", "ai/models"))
VAGUE = {"其他不當駕車行為", "尚未發現肇事因素"}

SQL = """
SELECT a.month, a.hour, a.weekday, a.weather, a.light, a.road_class, a.speed_limit,
       a.road_type_major, a.road_type_minor, a.position_major, a.position_minor,
       a.surface_state, a.signal_type, a.signal_action, a.divider_major, a.lane_fast_slow,
       a.sight, a.obstacle, ct.major AS collision_major, ct.minor AS collision_minor,
       p1.vehicle_major AS v1, p1.vehicle_minor AS v1_minor, p1.sex AS sex1, p1.age AS age1, p1.action_minor AS action1,
       p2.vehicle_major AS v2, a.party_count, cc.minor AS cause
FROM accident a
JOIN cause_code cc ON cc.id = a.main_cause_id
LEFT JOIN collision_type ct ON ct.id = a.collision_type_id
LEFT JOIN LATERAL (SELECT * FROM party p WHERE p.accident_id = a.id AND p.party_order = 1 LIMIT 1) p1 ON true
LEFT JOIN LATERAL (SELECT * FROM party p WHERE p.accident_id = a.id AND p.party_order = 2 LIMIT 1) p2 ON true
"""

# 事故發生前就知道的特徵（情境預測可用）
PRE_CRASH = ["hour_band", "weekday_type", "weather", "light", "road_class", "speed_band", "road_type_major",
             "road_type_minor", "position_major", "surface_state", "signal_type", "divider_major",
             "lane_fast_slow", "v1", "age_band", "sex1"]
# 事故發生後才知道的特徵（只用於對照模型 A）
POST_CRASH = ["collision_major", "collision_minor", "v2", "action1", "parties"]


def age_band(a: float) -> str:
    if pd.isna(a):
        return "不明"
    a = int(a)
    return "未滿18" if a < 18 else "18-24" if a < 25 else "25-44" if a < 45 else "45-64" if a < 65 else "65以上"


def hour_band(h: int) -> str:
    return {0: "深夜0-5", 1: "早上6-9", 2: "白天10-15", 3: "傍晚16-19", 4: "夜間20-23"}[
        0 if h < 6 else 1 if h < 10 else 2 if h < 16 else 3 if h < 20 else 4]


def speed_band(s: float) -> str:
    if pd.isna(s) or s <= 0:
        return "不明"
    return "≤30" if s <= 30 else "40" if s <= 40 else "50" if s <= 50 else "60" if s <= 60 else "≥70"


def featurize(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    out["hour_band"] = df["hour"].map(hour_band)
    out["weekday_type"] = np.where(df["weekday"] >= 5, "假日", "平日")
    out["speed_band"] = df["speed_limit"].map(speed_band)
    out["age_band"] = df["age1"].map(age_band)
    out["parties"] = df["party_count"].clip(upper=4).astype(str)
    for c in ["weather", "light", "road_class", "road_type_major", "road_type_minor", "position_major",
              "surface_state", "signal_type", "divider_major", "lane_fast_slow", "v1", "sex1",
              "collision_major", "collision_minor", "v2", "action1"]:
        out[c] = df[c].fillna("不明").astype(str)
    return out


def load() -> pd.DataFrame:
    with psycopg.connect(database_url()) as conn:
        cur = conn.execute(SQL)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def evaluate(name: str, y_true, proba, classes) -> dict:
    pred = classes[np.argmax(proba, axis=1)]
    return {
        "accuracy": round(float(accuracy_score(y_true, pred)), 4),
        "macro_f1": round(float(f1_score(y_true, pred, average="macro")), 4),
        "top3_accuracy": round(float(top_k_accuracy_score(y_true, proba, k=3, labels=classes)), 4),
        "n": int(len(y_true)),
    }


def baseline(y_train, y_eval, classes) -> dict:
    """永遠猜訓練資料中最常見的肇因；top-3 則猜最常見的 3 個。"""
    counts = y_train.value_counts()
    proba = np.tile([counts.get(c, 0) / len(y_train) for c in classes], (len(y_eval), 1))
    return evaluate("baseline", y_eval, proba, classes) | {"always": counts.index[0]}


def build_candidates(features: list[str]) -> dict:
    return {
        "logistic_regression": Pipeline([
            ("enc", ColumnTransformer([("oh", OneHotEncoder(handle_unknown="ignore", min_frequency=20), features)])),
            ("clf", LogisticRegression(max_iter=600, C=0.5, class_weight="balanced")),
        ]),
        "hist_gradient_boosting": Pipeline([
            ("enc", ColumnTransformer([("ord", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1,
                                                              encoded_missing_value=-1), features)])),
            ("clf", HistGradientBoostingClassifier(categorical_features=list(range(len(features))), max_iter=300,
                                                   learning_rate=0.08, max_leaf_nodes=48, l2_regularization=1.0,
                                                   class_weight="balanced", early_stopping=False, random_state=7)),
        ]),
    }


def run_task(df: pd.DataFrame, task: str) -> dict:
    t0 = time.time()
    full = task == "cause_full"
    train_df = df[df.month <= 6]
    classes_pool = train_df["cause"].value_counts()
    if not full:
        classes_pool = classes_pool[~classes_pool.index.isin(VAGUE)]
    top10 = list(classes_pool.index[:10])
    d = df[df.cause.isin(top10)].copy()
    X = featurize(d)
    feats = PRE_CRASH + (POST_CRASH if full else [])
    X = X[feats]
    y = d["cause"]
    tr, va, te = d.month <= 6, d.month.between(7, 8), d.month >= 9
    print(f"\n[{task}] 類別 {len(top10)}、特徵 {len(feats)}；訓練 {tr.sum():,}／驗證 {va.sum():,}／測試 {te.sum():,}")

    results, fitted = {}, {}
    for name, pipe in build_candidates(feats).items():
        s = time.time()
        pipe.fit(X[tr], y[tr])
        classes = pipe.classes_
        results[name] = evaluate(name, y[va], pipe.predict_proba(X[va]), classes)
        fitted[name] = pipe
        print(f"  {name:24s} 驗證 acc={results[name]['accuracy']:.3f} macroF1={results[name]['macro_f1']:.3f} "
              f"top3={results[name]['top3_accuracy']:.3f}（{time.time() - s:.0f}s）")
    best = max(results, key=lambda k: results[k]["macro_f1"])
    model = fitted[best]
    classes = model.classes_
    val_base = baseline(y[tr], y[va], classes)
    test = evaluate(best, y[te], model.predict_proba(X[te]), classes)
    test_base = baseline(y[tr], y[te], classes)
    # 驗證期（7–8 月）的結果也列出，方便和先前「1–6 月訓練、7–8 月測試」的實測比較
    report = classification_report(y[te], classes[np.argmax(model.predict_proba(X[te]), axis=1)], output_dict=True, zero_division=0)
    per_class = {c: {"f1": round(report[c]["f1-score"], 3), "support": int(report[c]["support"])} for c in classes}
    print(f"  → 選用 {best}；測試（9–10 月）acc={test['accuracy']:.3f} macroF1={test['macro_f1']:.3f}；"
          f"基準 acc={test_base['accuracy']:.3f} macroF1={test_base['macro_f1']:.3f}")
    return {
        "task": task, "algorithm": best, "classes": list(classes), "features": feats, "model": model,
        "validation": results, "validation_baseline": val_base,
        "test": test, "test_baseline": test_base, "per_class_test": per_class,
        "train_range": "115/01–115/06", "val_range": "115/07–115/08", "test_range": "115/09–115/10",
        "seconds": round(time.time() - t0),
    }


TASK_TEXT = {
    "cause_full": "肇因預測（對照）：前 10 大主要肇因，含事故型態等事後特徵",
    "cause_scenario": "肇因情境預測：前 10 大具體肇因，只用事故前已知的天候、時段、路口條件與用路人特徵",
}


def save(res: dict, version: str, use_db: bool) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_DIR / f"{res['task']}-{version}.joblib"
    joblib.dump({"model": res["model"], "classes": res["classes"], "features": res["features"], "version": version,
                 "task": res["task"]}, path, compress=3)
    meta = {k: v for k, v in res.items() if k != "model"}
    (MODEL_DIR / f"{res['task']}-{version}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    if not use_db:
        return
    with psycopg.connect(database_url()) as conn:
        conn.execute("UPDATE model_version SET is_active = false WHERE name = %s", (res["task"],))
        conn.execute(
            """INSERT INTO model_version (name, version, task, algorithm, train_range, test_range, metrics, baseline,
                                          artifact_path, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, true)
               ON CONFLICT (name, version) DO UPDATE SET metrics = EXCLUDED.metrics, baseline = EXCLUDED.baseline,
                   algorithm = EXCLUDED.algorithm, is_active = true, trained_at = now()""",
            (res["task"], version, TASK_TEXT[res["task"]], res["algorithm"], res["train_range"], res["test_range"],
             json.dumps(res["test"] | {"validation": res["validation"][res["algorithm"]], "per_class": res["per_class_test"]},
                        ensure_ascii=False),
             json.dumps(res["test_baseline"] | {"validation": res["validation_baseline"]}, ensure_ascii=False),
             str(path.relative_to(ROOT)).replace("\\", "/")))
        conn.commit()


def write_report(results: list[dict], version: str) -> None:
    lines = ["# AI 模型測試結果", "", f"模型版本：`{version}`（{datetime.now():%Y-%m-%d %H:%M}，`uv run python ai/train_cause_model.py` 產生）", "",
             "**時間切分**：1–6 月訓練、7–8 月驗證（選模型）、9–10 月最終測試。**基準**：永遠猜訓練資料最常見的肇因。", ""]
    for r in results:
        t, b = r["test"], r["test_baseline"]
        lines += [f"## {TASK_TEXT[r['task']]}", "",
                  f"- 選用演算法：`{r['algorithm']}`；類別數 {len(r['classes'])}；特徵：{', '.join(r['features'])}", "",
                  "| 資料 | 模型 | accuracy | macro-F1 | top-3 accuracy | 筆數 |", "|---|---|---:|---:|---:|---:|"]
        for name, m in r["validation"].items():
            lines.append(f"| 驗證 7–8 月 | {name} | {m['accuracy']:.3f} | {m['macro_f1']:.3f} | {m['top3_accuracy']:.3f} | {m['n']:,} |")
        vb = r["validation_baseline"]
        lines.append(f"| 驗證 7–8 月 | 基準（永遠猜「{vb['always']}」） | {vb['accuracy']:.3f} | {vb['macro_f1']:.3f} | {vb['top3_accuracy']:.3f} | {vb['n']:,} |")
        lines.append(f"| **測試 9–10 月** | **{r['algorithm']}** | **{t['accuracy']:.3f}** | **{t['macro_f1']:.3f}** | **{t['top3_accuracy']:.3f}** | {t['n']:,} |")
        lines.append(f"| 測試 9–10 月 | 基準 | {b['accuracy']:.3f} | {b['macro_f1']:.3f} | {b['top3_accuracy']:.3f} | {b['n']:,} |")
        lines += ["", "各類別（測試期）F1：", "", "| 肇因 | F1 | 筆數 |", "|---|---:|---:|"]
        for c, m in sorted(r["per_class_test"].items(), key=lambda kv: -kv[1]["support"]):
            lines.append(f"| {c} | {m['f1']:.3f} | {m['support']:,} |")
        lines.append("")
    lines += ["## 說明", "",
              "- 模型 B（情境預測）只使用事故發生前就能知道的資訊，所以 App 可以讓使用者選「天候、時段、交通工具」，預測在某個路口最可能的肇因並給對應提醒。",
              "- 模型 A（對照）加入事故型態等事後才知道的資訊，數字較高，但不能用來事前預測，只用來和先前的實測（accuracy 0.544、macro-F1 0.522）比較。",
              "- 每次 App 呼叫預測都會寫一筆 `prediction`（含 `model_version_id`），可回查是哪一版模型算的。",
              "- 不把 AI 主軸放在「預測事故件數」：先前實測只比歷史平均略好（Poisson deviance 0.371 vs 0.382）。"]
    (ROOT / "docs" / "ai-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db", action="store_true")
    args = ap.parse_args()
    version = datetime.now().strftime("%Y.%m.%d-%H%M")
    print("讀取資料…")
    df = load()
    print(f"共 {len(df):,} 件有主要肇因的事故")
    results = [run_task(df, "cause_scenario"), run_task(df, "cause_full")]
    for r in results:
        save(r, version, not args.no_db)
    write_report(results, version)
    print(f"\n完成：模型版本 {version}，報告 docs/ai-report.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# 資料庫筆數報告

產生時間：2026-10-20 02:01（`uv run python scripts/db_report.py` 自動產生）

- PostgreSQL 18.6；PostGIS 3.6.2

## 各資料表筆數

| 資料表 | 說明 | 筆數 |
|---|---|---:|
| `accident` | 事故（一件事故一列） | 284,116 |
| `party` | 當事人（原始 CSV 每一列） | 640,620 |
| `hotspot` | 危險路口（格網彙整） | 16,261 |
| `cause_code` | 肇因代碼 | 120 |
| `collision_type` | 事故類型及型態代碼 | 30 |
| `import_batch` | 匯入批次（原始檔） | 10 |
| `user_report` | 使用者回報 | 0 |
| `model_version` | AI 模型版本 | 0 |
| `prediction` | AI 預測紀錄 | 0 |

## 重點查詢

| 項目 | SQL | 結果 |
|---|---|---:|
| 事故件數 | `SELECT count(*) FROM accident` | 284,116 |
| 當事人列數 | `SELECT count(*) FROM party` | 640,620 |
| 當事者順位=1 的列數（應等於事故件數） | `SELECT count(*) FROM party WHERE party_order = 1` | 284,116 |
| 座標有效的事故 | `SELECT count(*) FROM accident WHERE coord_valid` | 283,785 |
| 已對應到危險路口的事故 | `SELECT count(*) FROM accident WHERE hotspot_id IS NOT NULL` | 77,555 |
| 115 年 1–8 月事故件數 | `SELECT count(*) FROM accident WHERE year = 2026 AND month <= 8` | 255,833 |
| 115 年 1–8 月當事人列數 | `SELECT count(*) FROM party p JOIN accident a ON a.id = p.accident_id WHERE a.year = 2026 AND a.month <= 8` | 577,324 |

## 各月份（依原始檔）

| 原始檔 | 事故件數 | 當事人列數 |
|---|---:|---:|
| 115_NPA_TMA2_01.zip | 35,750 | 80,618 |
| 115_NPA_TMA2_02.zip | 29,593 | 67,436 |
| 115_NPA_TMA2_03.zip | 33,716 | 75,880 |
| 115_NPA_TMA2_04.zip | 30,841 | 69,685 |
| 115_NPA_TMA2_05.zip | 31,342 | 70,965 |
| 115_NPA_TMA2_06.zip | 30,176 | 67,816 |
| 115_NPA_TMA2_07.zip | 32,236 | 72,492 |
| 115_NPA_TMA2_08.zip | 32,179 | 72,432 |
| 115_NPA_TMA2_09.zip | 26,933 | 60,302 |
| 115_NPA_TMA2_10.zip | 1,350 | 2,994 |
| **合計** | **284,116** | **640,620** |

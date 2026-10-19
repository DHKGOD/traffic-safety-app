# 任務清單

狀態：⬜ 待做　🔄 進行中　✅ 完成　⏸ 等使用者。負責方：Claude／Codex／使用者。
開工前把任務改成 🔄 並寫上負責方，避免兩邊重複做。

## 階段 0：開發環境
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | 安裝 Git、JDK 21、Android SDK、PostgreSQL＋PostGIS、Codex CLI | Claude |
| ✅ | MCP：context7、playwright、postgres（自寫唯讀）；Codex 外掛 | Claude |
| ✅ | S21 FE 開啟 USB 偵錯，adb 可見（R5CT72BKYGA） | 使用者 |

## 階段 1：資料與資料庫
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | 下載腳本（115 年 A2 1–10 月） | Claude |
| ✅ | 資料表設計＋ ER 圖＋ migration | Claude |
| ✅ | 匯入腳本、危險路口彙整、筆數報告 | Claude |
| ✅ | 一鍵啟動／停止、.env、雲端部署文件 | Claude |
| ✅ | 匯入腳本的單元測試（tests/test_import.py） | Codex（Claude 審查） |
| ⬜ | 危險路口改進：跨格線合併（DBSCAN 或鄰格合併），比較前後數量 | Codex |

## 階段 2：最小可用 App
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | API：附近／路線危險路口、體檢報告、回報、健康檢查、後台統計 | Claude |
| ✅ | 前端：地圖首頁、路口報告、回報、排行、設定（伺服器位址）、後台 | Claude |
| ✅ | APK 打包並安裝到 S21 FE | Claude |
| ✅ | 驗收：手機回報 → SQL 查得到 → 電腦瀏覽器看得到（USB 通道） | Claude＋使用者 |
| ⏸ | 改走 Wi-Fi：Windows 防火牆開放 TCP 8000 | 使用者 |

## 之後
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | 自訂路線：地名搜尋（Nominatim）＋路線（OSRM），後端代查；起點可用目前位置 | Claude |
| ✅ | AI 肇因預測：時間切分訓練（1–6 月訓練／7–8 月驗證／9–10 月測試）、和「永遠猜最常見」比較、寫入 model_version、API 預測並寫 prediction（docs/ai-report.md） | Claude |
| ✅ | 座標品質檢查（共用預設座標、座標與地址不符） | Claude |
| ✅ | UI 第二版（Apple 地圖版面）＋ E2E 測試 14 項＋實機巡檢腳本 | Claude |
| ⬜ | AI 天候／時段風險：用氣象署測站降雨時數校正 | Claude（需 CWA 授權碼） |
| ⬜ | 雨天模式自動切換（氣象署即時觀測＋預報） | Claude（需 CWA 授權碼） |
| ✅ | **背景守護模式**（前景服務＋定位、依速度判斷、靈動島懸浮提醒＋語音＋震動、展示模擬） | Claude |
| ✅ | 家人模式：分享代碼（shared_route）、常用路線、長輩模式 | Claude |
| ✅ | 模擬行走（語音＋提示音＋紅框） | Claude |
| ✅ | 匯出路口報告（HTML，可列印 PDF） | Claude |
| ✅ | 後台頁（筆數、資料表關係） | Claude |
| ✅ | App 圖示與啟動畫面 | Claude |
| ⬜ | 平板橫式版面實機測試 | 使用者＋Claude |
| ⬜ | 錄 Demo 備案影片 | 使用者 |
| ✅ | Codex 交叉審查第 1、2 次（8 項中 7 項成立已修正） | Codex＋Claude |

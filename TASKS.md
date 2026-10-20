# 任務清單

狀態：⬜ 待做　🔄 進行中　✅ 完成　⏸ 等使用者。負責方：Claude／Codex／使用者／其他 agent。
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
| ✅ | 危險路口改進：相鄰格子合併 | Claude |

## 階段 2：最小可用 App
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | API：附近／路線危險路口、體檢報告、回報、健康檢查、後台統計 | Claude |
| ✅ | 前端：地圖首頁、路口報告、回報、排行、設定（伺服器位址）、後台 | Claude |
| ✅ | APK 打包並安裝到 S21 FE；驗收：手機回報 → SQL 查得到 → 電腦看得到 | Claude＋使用者 |
| ✅ | 改走 Wi-Fi（Windows 防火牆＋Avast 信任網路） | 使用者 |

## 功能
| 狀態 | 任務 | 負責 |
|---|---|---|
| ✅ | 修復附近範圍漏算、返回排行未更新定位、背景守護路口資料截斷、Windows API 中斷後停止接收連線；pytest 51／E2E 24／Java 8 通過，乾淨 APK 已安裝 | Codex |
| ✅ | 自訂路線：地名搜尋（Nominatim）＋路線（OSRM） | Claude |
| ✅ | AI 肇因預測（時間切分、基準比較、model_version／prediction） | Claude |
| ✅ | 座標品質檢查 | Claude |
| ✅ | 天候自動模式（氣象署最近雨量站＋鄉鎮降雨機率）、天氣膠囊顯示氣溫 | Claude |
| ✅ | 背景守護模式（前景服務、靈動島、語音震動、展示模擬） | Claude |
| ✅ | 導航護航：護航浮動小圖示＋一鍵開 Google 地圖導航 | Claude |
| ✅ | 模擬行走（紅框、語音、靈動島／通知；切背景交給原生服務繼續） | Claude |
| ✅ | 家人模式：分享代碼、常用路線、長輩模式 | Claude |
| ✅ | 排行：附近（GPS、範圍 500m–5km 小地圖）／全國／自訂＋搜尋 | Claude |
| ✅ | 設定：危險通知偏好、開發者選項 | Claude |
| ✅ | 匯出路口報告、後台頁、App 圖示與啟動畫面 | Claude |
| ✅ | UI：Apple 地圖風格地圖頁、Apple 字級、改名「有路安」 | Claude |
| ⬜ | **實機驗證新 UI、背景模擬、護航小圖示**（見 HANDOFF「下一步」1） | 待指派（需手機解鎖） |
| ⬜ | AI 天候風險：用氣象署測站降雨時數校正（見 HANDOFF「下一步」2） | 待指派 |
| ⏸ | App 內更新（GitHub Releases）：程式已寫、未 commit，等使用者決定 | 使用者 |
| ⬜ | Codex 審查 `40b7dee..HEAD`（地圖標記、改名、字型、路線線寬） | 待指派 |
| ⬜ | 平板橫式版面實機測試 | 使用者＋agent |
| ⬜ | 錄 Demo 備案影片 | 使用者 |

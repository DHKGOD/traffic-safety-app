# HANDOFF 交接

> 每完成一個小任務、或對話快滿／額度快到時，都要更新本檔並 commit。接手方先讀 AGENTS.md、本檔、TASKS.md。

## 🔴 待我處理（只有使用者能做）

| # | 事項 | 怎麼做 | 狀態 |
|---|---|---|---|
| 1 | **Windows 防火牆開放 TCP 8000**（手機走 Wi-Fi 連電腦需要） | 系統管理員 PowerShell：`New-NetFirewallRule -DisplayName "交通安全App API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -RemoteAddress LocalSubnet -Action Allow -Profile Any` | 未完成（目前用 USB `adb reverse` 代替） |
| 2 | **氣象署開放資料授權碼**（雨天模式、天候風險 AI） | https://opendata.cwa.gov.tw 註冊登入 →「取得授權碼」→ 在 `.env` 加一行 `CWA_API_KEY=...` | 未完成 |
| 3 | **GitHub 遠端倉庫**（課程要求放 GitHub） | 決定公開或私人後執行：`gh repo create traffic-safety-app --private --source . --push`（公開把 `--private` 改 `--public`） | 未完成 |
| 4 | （選用）Google 地圖底圖 | 需 Google Cloud 帳號綁信用卡取得 Maps API 金鑰（付費服務）；目前已用免費 OpenFreeMap，不需要 | 不需要 |
| 5 | 重新開啟 Claude Code，讓 `.mcp.json` 的 MCP 與 codex 外掛在新工作階段載入 | 關掉再開，並在提示時允許專案 MCP | 已在本工作階段生效 |

## 目前階段與整體進度

- 階段 0（環境）✅、階段 1（資料庫）✅、階段 2（最小 App，APK 已在 S21 FE 上運作，驗收通過）✅
- 進行中：自訂路線規劃 → 接著 AI 肇因預測 → 背景守護模式 → 氣象署雨天模式

## 最後完成的事情

| commit | 內容 |
|---|---|
| `89a160c` | 前端 App（iOS 風格、MapLibre 向量地圖、報告、回報、排行、設定、後台、模擬行走）＋ Capacitor Android ＋ APK 打包腳本；階段 2 驗收通過 |
| `5483c54` | FastAPI 後端、一鍵啟動停止、API 測試、唯讀 Postgres MCP |
| `7d0bbf8` | 下載、資料表、匯入、危險路口；事故 284,116 件、當事人 640,620 列 |
| `e785c0c` | 初始化：AGENTS.md、CLAUDE.md、MCP 設定 |

驗收紀錄（2026-10-20 02:49）：手機送出回報 #4（near_miss，裝置 dev-5vp8jenbkkl4）→ `SELECT ... FROM user_report` 查得到並對應路口「福海街」→ 電腦瀏覽器「即時回報」頁顯示 #4。

## 進行中的工作

- 自訂路線（TASKS「之後」第一項）：尚未開始寫程式。
  - 規劃：後端 `backend/app/routers/geo.py` 新增 `GET /api/geo/search?q=`（Nominatim，需 User-Agent、快取、每秒 1 次）與 `GET /api/geo/route?from=lat,lon&to=lat,lon&mode=foot|bike|car`（routing.openstreetmap.de）；長路線（台北→苗栗約 100 km）要用 PostGIS `ST_DWithin(geom, line, buffer)` 查沿線路口，沒有 PostGIS 時用 bbox＋Python 計算。
  - 前端：點地圖上方路線卡 → modal「規劃路線」（起點：目前位置／搜尋；終點：搜尋；交通方式），結果取代 Demo 路線，可一鍵切回 Demo。

## 下一步（可直接開始）

1. 實作上面的自訂路線（後端＋前端），補 `tests/test_api.py` 測試。
2. AI：`ai/train_cause_model.py`（見 AGENTS.md「AI 任務」；時間切分、基準比較、寫 model_version）＋ `backend/app/routers/ai.py` 載入模型、`GET /api/ai/hotspots/{id}/causes` 寫入 prediction（前端報告頁已預留 `.ai-slot` 會自動顯示）。
3. 背景守護模式（Android 原生外掛）。
4. `/codex:review` 交叉審查，修正後記錄在下方。

## 已知問題與注意事項

- **專案路徑含中文**：PostgreSQL 程式不能放在專案內（initdb 失敗），所以裝在 `%LOCALAPPDATA%\Programs\pgsql18`；Gradle 需 `android.overridePathCheck=true`（已設）。
- **防毒軟體攔截 TLS**：Python 用 truststore、uv 設 `UV_SYSTEM_CERTS=1`、Gradle 用 Windows-ROOT（`frontend/android/gradle.properties` 與 `scripts/build_apk.ps1` 已處理）。
- **Claude 桌面版的 AppData 虛擬化**：由 Claude 寫進 AppData 的檔案其他程式看不到。Android SDK 因此放 `%USERPROFILE%\Android\Sdk`。
- **.ps1 檔要存成 UTF-8 含 BOM**（Windows PowerShell 5.1 才讀得懂中文）。
- Claude 內建瀏覽器沒有 WebGL，看不到 MapLibre 底圖；用 Playwright MCP 或手機測試。
- `adb reverse` 在手機重新插拔後會失效，要重跑 `adb reverse tcp:8000 tcp:8000`。
- 危險路口格網法：路口剛好跨格線時會拆成兩格（Demo 路線「3」號附近有重疊標記）。
- 本工作階段曾被 fork，兩個 Claude 同時寫 frontend；已統一回原架構（`src/main.js` 為入口，刪除 fork 的 app.js／native.js／views/walk.js）。

## 如何驗證目前成果

| 驗證 | 指令 | 預期結果 |
|---|---|---|
| 啟動 | 雙擊 `start_server.bat` | 印出本機與區網網址 |
| API 健康 | `curl http://127.0.0.1:8000/api/health` | `"status":"ok"`、`"postgis":true` |
| 筆數 | `uv run python scripts/db_report.py` | accident 284,116；party 640,620；1–8 月 255,833 |
| 測試 | `uv run pytest` | 9 passed |
| MCP | `uv run python scripts/verify_mcp.py` | 三個都 [OK]，postgres 查到 284116 |
| 前端 | `cd frontend && npx vite build` | built 無錯誤 |
| APK | `powershell -ExecutionPolicy Bypass -File scripts\build_apk.ps1` | `dist/traffic-safety-debug.apk`，有接手機則自動安裝 |

## 交叉審查紀錄

（尚未執行 `/codex:review`）

# 路口安全通：交通安全路口提醒 App（資料庫課程專題）

用內政部警政署「交通事故 A2 類」開放資料（115 年 1–10 月，**事故 284,116 件／當事人 640,620 列**），做危險路口提醒與分析的 Android App。

> 依官方歷史事故統計提醒注意，不保證路況安全。

GitHub：https://github.com/DHKGOD/traffic-safety-app

| 部分 | 技術 |
|---|---|
| 資料庫 | PostgreSQL 18 ＋ PostGIS 3.6（資料目錄在專案內 `db/pgdata`，模擬雲端） |
| 後端 | Python FastAPI（`backend/`） |
| 前端 | Vite ＋ Leaflet ＋ MapLibre 向量地圖（`frontend/`），Capacitor 8 包成 Android APK |
| AI | scikit-learn 肇因預測（`ai/`，模型版本存在資料庫） |

文件：[ER 圖](docs/er-diagram.md)・[資料庫筆數報告](docs/db-report.md)・[AI 測試結果](docs/ai-report.md)・[技術決策](docs/decisions.md)・[搬到雲端](docs/deploy-cloud.md)・[Claude／Codex 接力](docs/ai-handoff.md)・[交接](HANDOFF.md)・[任務](TASKS.md)

## 功能

| 功能 | 說明 |
|---|---|
| 路線上的危險路口 | Demo 路線輔大 → 新莊捷運站；也可搜尋任意起訖點（例：台北車站 → 苗栗車站），步行／自行車／汽機車 |
| 晴天／雨天、時段模式 | 依事故發生時的天候與時段篩選危險路口（iOS 動作表切換） |
| **天候自動模式** | 後端代查中央氣象署（最近自動雨量站的過去 1 小時雨量＋鄉鎮 3 小時降雨機率），下雨或降雨機率 ≥ 60% 自動切到雨天模式；每 10 分鐘更新。授權碼只放伺服器 `.env` 的 `CWA_API_KEY`，沒設定時 App 自動隱藏此選項 |
| 路口體檢報告 | 事故數、受傷、雨天與夜間占比、24 小時分布、主要肇因、事故型態、車種、年齡、改善建議、附近回報；可匯出 HTML（列印成 PDF） |
| **AI 情境預測** | 選天候、時段、交通工具、年齡，預測這個路口最可能的事故肇因與提醒；每次預測記錄模型版本（[測試結果](docs/ai-report.md)） |
| 模擬行走 | 藍點沿路線移動，接近危險路口時語音＋提示音＋紅框（平板沒有 GPS 也能展示） |
| **背景守護模式**（Android） | 切到 Google 地圖或滑手機時，接近危險路口跳出「靈動島」懸浮提醒＋語音＋震動；依速度自動判斷步行／騎車／開車，搭大眾運輸可靜音；展示用路線模擬 |
| **家人模式** | 替長輩規劃路線 → 產生 6 碼代碼（存資料庫）→ 長輩手機輸入代碼下載；長輩模式（大字、提早提醒、語音放慢） |
| 回報「差點被撞」 | 存入資料庫，其他裝置 5 秒內在地圖與動態牆看到 |
| 排行 | 新莊區／泰山區／全國，依天候時段排序 |
| 後台 | 各資料表筆數（即時 SQL）、資料表關係、各月件數 |
| 設定 | 伺服器位址（換雲端不必重新打包）、深淺色、守護模式、靈動島權限 |

---

## 1. 啟動伺服器（資料庫＋API）

**Windows：雙擊 `start_server.bat`**（停止用 `stop_server.bat`）。Linux／雲端主機用 `./start_server.sh`、`./stop_server.sh`。

第一次執行會自動：產生 `.env`（含隨機密碼）→ 建立資料庫 → 建表 → 匯入資料（約 1–2 分鐘）。完成後畫面會印出：

```
本機瀏覽器：http://127.0.0.1:8000/
手機／平板（同一個 Wi-Fi）請在 App 設定頁輸入：http://192.168.x.x:8000
API 文件：http://127.0.0.1:8000/docs
```

手機連不到時：確認在同一個 Wi-Fi，並在 Windows 防火牆開放 TCP 8000（見 HANDOFF.md「待我處理」）。用 USB 測試時可用 `adb reverse tcp:8000 tcp:8000`，App 位址填 `127.0.0.1:8000`。

## 2. 重建資料庫

```bash
uv run python scripts/rebuild_db.py              # 重新匯入（保留使用者回報與模型紀錄）
uv run python scripts/rebuild_db.py --download   # 先重新下載原始資料
uv run python scripts/rebuild_db.py --reset      # 連資料表一起刪掉重建（回報也會清空）
uv run python scripts/db_report.py               # 只查各表筆數，寫入 docs/db-report.md
```

個別步驟：`scripts/download_data.py`（下載到 `data/raw/`）→ `scripts/migrate.py`（套用 `migrations/*.sql`）→ `scripts/import_accidents.py` → `scripts/build_hotspots.py`。

## 3. 打包並安裝 APK

前置：JDK 21、Android SDK（`%USERPROFILE%\Android\Sdk`）、手機開啟 USB 偵錯並接上電腦。

```bash
powershell -ExecutionPolicy Bypass -File scripts\build_apk.ps1
```

會建置前端 → 同步 Capacitor → Gradle 打包 → 複製到 `dist/traffic-safety-debug.apk` → 若有接手機就 `adb install` 並開啟。只打包不安裝加 `-NoInstall`。

第一次開 App 會要求輸入伺服器位址（之後可在「設定」頁修改，換到雲端不用重新打包）。

## 4. 開發

```bash
uv sync                        # Python 套件
cd frontend && npm install
npm run dev                    # 前端開發伺服器 http://localhost:5173（API 位址在設定頁填 http://127.0.0.1:8000）
uv run python ai/train_cause_model.py   # 重新訓練 AI（約 2 分鐘，寫入 model_version 與 docs/ai-report.md）
```

### 測試（每次修改後都要跑）

| 測試 | 指令 | 內容 |
|---|---|---|
| 後端＋資料處理 | `uv run pytest` | 43 項：API、PostGIS 與替代查詢一致、回報、路線分享、AI、匯入純函式、路口合併 |
| 端對端（模擬真人操作） | `powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1` | 18 項：Playwright 手機尺寸＋平板橫式，實際點完每個功能（結束後自動清除測試資料） |
| 守護模式邏輯（Java） | `powershell -ExecutionPolicy Bypass -File scripts\test_guardian.ps1` | 7 項：提醒距離、接近判斷、冷卻、搭車靜音、長輩模式 |
| 實機巡檢（S21 FE） | `adb reverse tcp:8000 tcp:8000` 後 `uv run python scripts/phone_tour.py` | 自動點過 22 個畫面、收集 JS 錯誤、截圖到 `logs/phone_tour/` |
| 實機背景守護 | `uv run python scripts/guardian_device_test.py 60` | 開始路線模擬 → 回到桌面 → 確認提醒與靈動島截圖 |

## 5. 開發環境與工具清單

| 工具 | 版本 | 位置／來源 |
|---|---|---|
| Windows 11 Pro | 26200 | — |
| Python（uv 管理） | 3.11 | uv 0.13 |
| Node.js / npm | 24.20 / 11.19 | 已安裝 |
| Git | 2.55 | winget `Git.Git` |
| JDK | Microsoft OpenJDK 21.0.12 | winget `Microsoft.OpenJDK.21` |
| Android SDK | platform-tools（adb）、platforms;android-36、build-tools;36.0.0 | `%USERPROFILE%\Android\Sdk`（Google 官方 cmdline-tools） |
| PostgreSQL ＋ PostGIS | 18.6 ＋ 3.6.2 | `%LOCALAPPDATA%\Programs\pgsql18`（`scripts/install_postgres.ps1`，EDB＋OSGeo 官方） |
| Docker | 未使用 | 見 docs/decisions.md D1 |
| GitHub CLI | 2.101（已登入） | 已安裝 |
| Codex CLI | 0.163 | `npm i -g @openai/codex`（OpenAI 官方） |

### MCP server 與外掛（已驗證可用：`uv run python scripts/verify_mcp.py`）

| 名稱 | 用途 | 來源 | 設定 |
|---|---|---|---|
| context7 | 查詢最新官方文件（FastAPI、Capacitor、Leaflet、MapLibre…） | Upstash 官方 `@upstash/context7-mcp` | `.mcp.json`、`.codex/config.toml` |
| playwright | 自動操作瀏覽器測試網頁畫面 | Microsoft 官方 `@playwright/mcp` | 同上 |
| postgres | 直接查詢本機資料庫（唯讀帳號 `mcp_readonly` ＋ READ ONLY 交易） | 本專案自寫 `tools_mcp/pg_readonly_mcp.py`（官方 MCP Python SDK） | 同上 |
| codex（Claude Code 外掛） | `/codex:review`、`/codex:rescue` 等，與 Codex 交叉審查、委派任務 | OpenAI 官方 `openai/codex-plugin-cc` | 使用者層級外掛 |
| GitHub | 用已登入的 `gh` CLI（建 repo、PR、issue） | GitHub 官方 | — |

## 6. 專案結構

```
backend/app/          FastAPI（routers/：hotspots、reports、system、ai）
frontend/src/         前端（views/ 各頁、styles/ 設計系統、map-utils.js 地圖）
frontend/android/     Capacitor Android 專案
migrations/           資料表 migration（*.postgis.sql 只在有 PostGIS 時套用）
scripts/              下載、匯入、重建、啟動、打包、MCP 驗證
ai/                   AI 訓練與模型
tools_mcp/            自寫的唯讀 Postgres MCP
tests/                API 測試
docs/                 ER 圖、筆數報告、決策、雲端部署、接力說明
data/raw/  db/pgdata/ 原始資料與資料庫（不進 Git，可由腳本重建）
```

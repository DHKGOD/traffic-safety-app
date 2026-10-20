# HANDOFF 交接

> 每完成一個小任務、或對話快滿／額度快到時，都要更新本檔並 commit。接手方先讀 AGENTS.md、本檔、TASKS.md。
> 最後更新：2026-10-20（Codex，修復提交 `84b006e`、`1dc4ff6`，測試完成）。App 名稱已改為 **「有路安」**（套件名稱仍是 `tw.edu.fju.trafficsafety`，不要改，否則手機要重裝）。

## Codex 修復完成（2026-10-20）

- 分支 `codex/fix-nearby-coverage`，修復三項實測問題：附近範圍預覽漏算、返回附近排行不更新定位、背景守護下載被前 200 名截斷。
- `/api/hotspots/near` 新增 `complete=true`：回傳半徑內全部符合天候／時段的路口，半徑仍限制 50–5000m；預設排行仍保留 limit。範圍小地圖與 Android 守護已改用完整資料。
- 返回附近排行會重新定位，並停用定位結果的舊快取。搜尋指定地點／自訂地區仍保留原選擇。
- 回歸證據：新增後端測試修正前 2 項失敗、修正後 pytest 50 passed（含 PostGIS 與替代查詢）；新增／加強兩個瀏覽器情境，舊版皆失敗。Java 邏輯測試 8 passed。
- 額外畫面驗證：台北車站 500m 預覽與清單皆為 23 處（舊預覽只有 8）；定位移到台中後重新查詢新座標。3km 守護完整資料有 506 處，包含先前漏掉的 ID 8318。
- 最終驗證：pytest **51 passed**、完整 E2E **24 passed（3.2 分鐘）**、Java **8 tests**。E2E 測試回報 2 筆／分享路線 1 筆已清除。新版 APK 已建置安裝；擱置的 App 更新四個檔案及 `update/` 原封保留，未包含在本次 commit 或乾淨 APK 中。
- 修復提交 `84b006e`；APK 已以乾淨提交建置並覆蓋安裝 S21 FE（保留資料），裝置 APK 與本機 SHA-256 一致，啟動 Status ok。Android lint 0 errors／26 warnings；手機鎖定，UI／背景提醒尚未實機驗證。
- 第一輪完整 E2E 的前 21 項通過，但 Windows Python 3.11 Proactor 遇 WinError 64 後關閉監聽 socket，最後 3 項連線被拒絕（程序仍在，見 `logs/codex-fix-e2e-attempt1.txt` 與 `logs/api.log`）。已將 Windows 的一鍵啟動改為 Uvicorn 自訂 Selector 迴圈（`backend/app/runtime.py`），Linux 保留原行為。pytest 含客戶端 RST 連線回歸；運行中 API 另完成 200 次 TCP RST＋100 次 health 查詢全數成功，修正後完整 E2E 全數通過。
- 測試紀錄在 `logs/codex-fix-e2e-20261020.txt`、`logs/codex-fixed-probe-result.txt`；修復前證據見 `logs/codex-test-report-20261020.md`。手機仍鎖定，尚未宣稱實機驗證完成。

## 🔴 待我處理（只有使用者能做）

| # | 事項 | 怎麼做 | 狀態 |
|---|---|---|---|
| 1 | **手機解鎖讓 agent 做實機測試** | 手機接 USB、解鎖、螢幕保持亮著 | ⏸ 等使用者（背景提醒、護航小圖示、新版 UI 都還沒實機驗證） |
| 2 | **決定 App 內更新（GitHub Releases）要不要做** | 見下方「進行中的工作」：保留中、未 commit | ⏸ 等使用者決定 |
| 3 | **同意推送到 GitHub**（本機有未推送提交） | 跟 agent 說「推上去」；推送前 agent 要再掃一次金鑰 | ⏸ 等使用者 |
| 4 | 在手機開啟「靈動島與護航小圖示權限」 | App →「設定」→ 該項 → 系統頁面開啟「有路安」（測試期間已用 adb 開啟；正式展示前在手機上確認一次） | 已用 adb 開啟（測試用） |
| 5 | （選用）三星通知彈出樣式改「詳細」 | 手機「設定 → 通知 → 通知彈出樣式」；不改也沒關係，靈動島會提醒 | 選用 |
| — | 已完成：Windows 防火牆＋Avast 信任 Wi-Fi、氣象署授權碼（`.env` 的 `CWA_API_KEY`）、GitHub 公開倉庫 https://github.com/DHKGOD/traffic-safety-app | | ✅ |

## 給新 agent 的 5 分鐘導覽

**使用者偏好（很重要）**
- 全程用**繁體中文**回覆與寫 commit 訊息；commit 結尾加 `Co-Authored-By` 行（見 git log）。
- UI 要有 **Apple 原生 App 的質感**；地圖頁參考 Apple 地圖（浮動卡片抽屜），細節參考 Google 地圖（App 名稱字樣）。使用者會傳 iPhone 截圖比對，改完要**截圖給他看**（Playwright 手機尺寸 412×892，淺色＋深色）。
- **功能不能有 bug**：每次改動要跑 E2E；能上手機就實機驗證。
- 不推送 GitHub、不刪專案外的東西、不改系統設定，除非使用者明確同意。
- 使用者常常在 agent 工作中途插話提新需求：先把手上的做完或安全停下，再接新需求，並在回覆裡說明。

**電腦與手機**
- Windows 11、PowerShell 5.1（每個指令先重新載入 PATH，見 CLAUDE.md）；`.ps1` 要存 **UTF-8 含 BOM**。
- 伺服器：`start_server.bat`（或 `uv run python scripts/server.py start`），API＋資料庫在 `http://<電腦IP>:8000`。電腦 IP 192.168.1.108；手機 S21 FE（adb 序號 R5CT72BKYGA，IP 192.168.1.112）走 Wi-Fi 連電腦，App 伺服器位址設 `192.168.1.108:8000`。
- 改了後端（`backend/`）要重啟伺服器；改了前端要 `cd frontend; npx vite build`（伺服器直接提供 `frontend/dist`，電腦瀏覽器開 http://127.0.0.1:8000 就是網頁版 App）。

**程式地圖（新功能大概會動到的地方）**

| 區塊 | 檔案 |
|---|---|
| 後端 API | `backend/app/main.py`（掛 router）、`routers/hotspots.py`（附近／路線／排行／`areas`／體檢報告）、`reports.py`（回報）、`ai.py`（AI 預測）、`geo.py`（地名搜尋、OSRM 路線）、`routes.py`（家人分享代碼）、`weather.py`（氣象署：最近雨量站＋鄉鎮預報＋氣溫）、`system.py`（health、後台統計） |
| 資料庫 | `migrations/*.sql`（001 核心、002 PostGIS、003 座標品質、004 分享路線）；新表請加 `005_...sql`，`scripts/migrate.py` 會自動套用 |
| 前端入口與狀態 | `frontend/src/main.js`（分頁、堆疊、開發者選項的 devWalk）、`store.js`（路線、天候時段模式、回報輪詢）、`api.js`、`ui.js`（Stack、makePage、segmented、modal、actionSheet、toast、LEVEL） |
| 前端頁面 | `views/map.js`（Apple 地圖風格首頁：天氣膠囊、抽屜四段、快捷圓鈕、右側直式膠囊、地圖左下「有路安」）、`ranking.js`（附近／全國／自訂＋搜尋＋附近範圍小地圖）、`report.js`（路口體檢＋AI 情境預測）、`settings.js`（伺服器、危險通知、背景守護、開發者選項）、`feed.js`、`submit.js`、`planner.js`、`family.js`、`admin.js` |
| 前端功能模組 | `walk.js`（模擬行走，切背景交給原生服務）、`guardian.js`（原生守護外掛介面）、`alerts.js`（危險通知偏好，同步原生）、`weather.js`（天候自動模式、天氣膠囊資料）、`map-utils.js`（MapLibre 底圖、標記、Apple 風格路線線寬隨縮放）、`export.js` |
| 樣式 | `styles/base.css`（色彩、字型、Apple 字級）、`components.css`（共用元件、iOS 開關）、`views.css`（各頁） |
| Android 原生 | `frontend/android/app/src/main/java/tw/edu/fju/trafficsafety/guardian/`：`GuardianService`（前景服務、模擬、提醒、通知頻道、提醒偏好）、`GuardianPlugin`（JS 介面：start/stop/status/walkAlert/setAlertPrefs/openNavigation…）、`GuardianEngine`（提醒判斷，純 Java 有單元測試）、`IslandOverlay`（靈動島）、`EscortBubble`（護航浮動小圖示） |
| AI | `ai/train_cause_model.py`（肇因預測，時間切分、基準比較、寫 model_version）；報告 `docs/ai-report.md` |
| 測試 | `tests/`（pytest）、`frontend/e2e/app.spec.js`（Playwright 23 項）、`scripts/phone_tour.py`（實機巡檢）、`scripts/background_alert_test.py`（實機背景提醒）、`scripts/test_guardian.ps1`（Java） |

## 目前階段與整體進度

- ✅ 階段 0 環境、階段 1 資料庫（事故 284,116 件／當事人 640,620 列）、階段 2 App（S21 FE 實機驗收通過）
- ✅ 自訂路線（Nominatim＋OSRM）、座標品質檢查、危險路口合併改良
- ✅ AI 肇因預測（時間切分、和「永遠猜最常見」比較、model_version／prediction 可回查）＋報告頁「AI 情境預測」
- ✅ 背景守護（前景服務、靈動島、語音震動）、家人模式（分享代碼、長輩模式）、App 圖示、平板橫式版面
- ✅ 氣象署天候自動模式（下雨或降雨機率 ≥60% 自動切雨天）；地圖左上天氣膠囊顯示氣溫
- ✅ **地圖頁 Apple 地圖風格**：浮動卡片抽屜（最小只剩搜尋列）、路線摘要卡（不標「即時」，註明 115 年 1–10 月官方統計）、快捷圓鈕（模擬行走／背景守護／回報／時段）、右側直式膠囊（整條路線／我的位置／守護）、地圖左下「有路安」字樣（Google 地圖式小淡字）
- ✅ 地圖標記：危險點改「!」圓形圖示（拉遠縮成小點，不放名次數字）；路線半透明亮藍＋深藍外框，線寬隨縮放；路線中間「N 分鐘」泡泡；選取路口時移到抽屜上方
- ✅ 排行：附近（GPS，可選 500m–5km，小地圖預覽）／全國／自訂（縣市→行政區，記在手機）＋搜尋
- ✅ 模擬行走跳靈動島／通知，按主畫面鍵交給原生服務背景繼續；導航護航（護航浮動小圖示＋一鍵開 Google 地圖導航）
- ✅ 設定「危險通知」（提醒方式／等級／時機／語音／提示音／震動）與「開發者選項」
- ✅ App 改名「有路安」；文字照 Apple iOS 字級／行高／字距（Inter 光學尺寸版＋系統中文字型）
- ✅ Codex 交叉審查 4 次（共 20 項，19 項成立已修正）
- ⬜ **實機驗證**：上面標 ✅ 的新 UI、背景模擬、護航小圖示都只在電腦（Playwright）驗證過，手機還沒測
- ⬜ AI 任務 2：天候風險用測站降雨時數校正
- ⬜ App 內更新（擱置，等使用者決定）

## 最後完成的事情

| commit | 內容 |
|---|---|
| `551e7bb` | 導航藍線改細、線寬隨縮放 |
| `cfb131e` | 導航藍線半透明 |
| `142e832` | 路線摘要拿掉「即時」、註明統計期間；整條路線右側留空間給膠囊 |
| `321ebc8` | App 名稱靠左、盾牌移到右側膠囊 |
| `945cc75` | App 名稱改小改淡；地圖資料來源移到設定「關於」 |
| `9973bd9` | 改名「有路安」、地圖左下 App 名稱、Apple 字級 |
| `5651325` | 危險點「!」圖示、Apple 風格路線、時間泡泡、選取時移到抽屜上方 |
| `40b7dee` / `14511b8` | 地圖頁 Apple 地圖風格；Codex 第 4 次審查 3 項 |
| `f88e7f7` / `23c8537` | 危險通知、開發者選項、排行附近範圍小地圖、背景提醒測試腳本 |
| `33766bf` | 抽屜最小化、排行附近／全國／自訂＋搜尋、模擬行走背景執行、導航護航小圖示 |
| `646d51f` | 天候自動模式（**GitHub 上目前停在這個 commit**） |

（更早的 commit 用 `git log --oneline` 查。）

## 進行中的工作

- **App 內更新（GitHub Releases）先擱置、未 commit**：`frontend/package.json`（版本 0.2.0）、`frontend/android/app/build.gradle`（版本號讀 package.json）、`AndroidManifest.xml`（REQUEST_INSTALL_PACKAGES）、`MainActivity.java`（註冊 AppUpdatePlugin）、新檔 `update/AppUpdatePlugin.java`。使用者說「先保留、不要 commit 也不要還原，等我決定」。
  - **commit 時只 `git add` 指定檔案，絕對不要 `git add -A` / `git add .`**，也不要 `git stash`／`checkout` 掉它們。
  - **打包 APK 一律用 `scripts\build_apk_clean.ps1`**：從最新 commit 在 `%TEMP%\youluan-apkbuild` 打包，不會把這些未決定的修改包進去（直接用 `build_apk.ps1` 會包進去）。
  - 若要改 `AndroidManifest.xml` 或 `MainActivity.java`（上面四個檔案之一），先問使用者，因為會和擱置的修改混在一起。

## 下一步（可直接開始）

1. **手機實機驗證**（手機解鎖後）：`powershell -ExecutionPolicy Bypass -File scripts\build_apk_clean.ps1` 安裝最新版 → `uv run python scripts/phone_tour.py`（23 步、JS 錯誤 0）→ `uv run python scripts/background_alert_test.py bg 50` 與 `... nav 50`（`logs/background_test/` 截圖要看到靈動島與護航小圖示、輸出提醒 ≥1）。注意 `phone_tour.py` 的步驟選擇器是舊版 UI 寫的（例如 `05_sheet_half` 現在是收到最小），失敗先對照 `views/map.js` 更新。
2. **AI 任務 2（天候風險校正）**：先實際呼叫確認氣象署有沒有 2026 年逐日／逐時雨量的資料集（不要憑記憶猜；API 格式紀錄見 `backend/app/routers/weather.py` 開頭）；計算各行政區「下雨時數占比」，雨天風險倍數 = 雨天事故占比 ÷ 下雨時數占比；寫入新表（`migrations/005_...`），報告頁顯示「下雨時事故風險是平常的 N 倍」。
3. （選用）背景守護用 Activity Recognition 區分搭車與開車；錄 Demo 影片。

## 已知問題與注意事項

- **三星「通知彈出樣式：簡要」會停用一般 App 的彈出橫幅** → 主要提醒用自己畫的靈動島（SYSTEM_ALERT_WINDOW）；「危險通知 → 提醒方式」可選同時跳橫幅。
- **Android 不能用 Apple 字型**（授權不允許、手機也沒有）：英數用 Inter（`@fontsource-variable/inter/opsz.css`），中文用系統字型；Apple 感來自字級、行高、字距與等寬數字。
- **地圖資料來源**（OpenFreeMap、© OpenStreetMap）依授權要標示：目前在「設定 → 關於」，地圖上的 Leaflet 標示已隱藏（使用者要求）。不要移除「關於」裡的來源。
- **Gradle 在中文路徑**：已用 `android.overridePathCheck=true`；Java 單元測試用 `scripts\test_guardian.ps1`（在英文暫存路徑跑 javac＋JUnit）。
- **S21 FE 的 WebView 開 backdrop-filter 會畫錯**：App 內 `html.no-blur` 改實色；電腦瀏覽器仍有毛玻璃。
- PostgreSQL 程式在 `%LOCALAPPDATA%\Programs\pgsql18`（中文路徑問題），資料目錄在專案 `db/pgdata`；Android SDK 在 `%USERPROFILE%\Android\Sdk`。
- 防毒攔截 TLS：Python 用 truststore、`UV_SYSTEM_CERTS=1`、Gradle 用 Windows-ROOT（已處理）。
- Claude 內建瀏覽器沒有 WebGL（地圖空白）→ 用 Playwright MCP 或手機看畫面。
- 手機螢幕關掉時 WebView 會暫停，實機腳本要先解鎖、保持亮著。
- AI 模型檔（*.joblib）不進 Git，`uv run python ai/train_cause_model.py` 重建；9–10 月測試資料只到 115/10/16。
- 危險路口格網法：跨格線的路口可能拆成兩格（已用相鄰格合併改善，未完全消除）。

## 如何驗證目前成果

| 驗證 | 指令 | 預期結果 |
|---|---|---|
| 啟動 | 雙擊 `start_server.bat` | 印出本機與區網網址 |
| 筆數 | `uv run python scripts/db_report.py` | accident 284,116；party 640,620 |
| 後端測試 | `uv run pytest` | 51 passed |
| 端對端測試 | `powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1` | 24 passed（約 3.2 分鐘，結束自動清測試資料） |
| 單項 E2E | `cd frontend; npx playwright test -g "排行"` | 指定測試通過 |
| 守護邏輯 | `powershell -ExecutionPolicy Bypass -File scripts\test_guardian.ps1` | OK (8 tests) |
| 打包 APK | `powershell -ExecutionPolicy Bypass -File scripts\build_apk_clean.ps1`（`-NoInstall` 只打包） | `dist/traffic-safety-debug.apk`，有接手機則安裝 |
| 實機巡檢 | `uv run python scripts/phone_tour.py` | 23 步驟、JS 錯誤 0（見「下一步」1 的注意） |
| 背景提醒實機 | `uv run python scripts/background_alert_test.py bg 50`（或 `nav`） | 提醒 ≥1，截圖在 `logs/background_test/` |
| AI | `uv run python ai/train_cause_model.py`（約 2 分鐘） | 產生 `docs/ai-report.md`，model_version 有兩筆 is_active |
| MCP | `uv run python scripts/verify_mcp.py` | 三個 [OK] |

## 交叉審查紀錄

### 第 1 次（Codex，e785c0c..256f30f）5 項全成立已修正
全新環境沒有 dist／匯入後步驟不續做／沒有模型／測試連線忽略資料庫異常／設定頁顯示錯模型 → 一鍵啟動自動補建、testServer 檢查 database.ok。

### 第 2 次（Codex，256f30f..3f43567：背景守護）3 項，2 項成立
START_STICKY 重啟 intent 為 null（成立，從 SharedPreferences 恢復）；VibrationEffect 在 API 24–25 不存在（成立，改舊 API）；hasSpeed() 不存在（**不成立**，API 1 就有，Lint 0 錯誤）。

### 第 3 次（Codex，3e74c83..2e02eb7：家人模式、路口合併）4 項全成立已修正
分享代碼防猜（10 分鐘 10 次 → 429）、E2E 只清自己產生的代碼、守護中切長輩模式即時生效、路口合併順序固定。

### 第 4 次（Codex，4b312ae..847f297：天候自動、地圖／排行改版、背景模擬、危險通知）3 項全成立已修正

| # | Codex 指出 | 處理 |
|---|---|---|
| 1 | 氣象署時間字串沒有時區時比較會例外，`/api/weather/now` 500 | `_ts()` 沒有時區視為台灣時間；pytest 加測 |
| 2 | 開 App 的天氣請求進行中選「自動」會被誤判失敗 | 共用進行中的請求，完成時依最新自動模式套用 |
| 3 | 只用靈動島時「提示音」設定無效 | 只用靈動島且開提示音時由 App 播系統通知音 |

**`14511b8` 之後的 UI 修改（地圖標記、改名、字型、路線線寬等）還沒經過 Codex 審查**，下次審查範圍：`40b7dee..HEAD`。

### 本次 Codex 環境備註
- 本機測試瀏覽器放在專案 `logs/playwright-browsers`。此 Codex 環境執行 E2E 前設定 `$env:PLAYWRIGHT_BROWSERS_PATH='E:\User\桌面\資料庫專題\logs\playwright-browsers'`，避免到不同代理程式的預設快取尋找。下載時用 `$env:NODE_USE_SYSTEM_CA='1'` 處理既有防毒憑證，不關閉 TLS 驗證。
- 鎖定畫面冷啟動時，裝置日誌曾出現 Capacitor `triggerEvent` 初始化例外；尚無解鎖後操作重現證據，需在手機解鎖後巡檢，不將這次安裝成功當成 UI／背景提醒已實機驗證。

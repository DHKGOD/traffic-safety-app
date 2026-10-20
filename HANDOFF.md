# HANDOFF 交接

> 每完成一個小任務、或對話快滿／額度快到時，都要更新本檔並 commit。接手方先讀 AGENTS.md、本檔、TASKS.md。

## 🔴 待我處理（只有使用者能做）

| # | 事項 | 怎麼做 | 狀態 |
|---|---|---|---|
| 1 | **Windows 防火牆開放 TCP 8000**（手機走 Wi-Fi 連電腦需要；目前用 USB `adb reverse` 代替） | 系統管理員 PowerShell：`New-NetFirewallRule -DisplayName "交通安全App API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -RemoteAddress LocalSubnet -Action Allow -Profile Any`，之後 App 設定頁改成 `192.168.1.108:8000`。**另外 Avast 防火牆要把 Wi-Fi「0420tutu 2」設為「信任」**（否則手機連不到） | ✅ 完成（2026-10-20 手機 Wi-Fi 實測 `/api/health` ok） |
| 2 | **氣象署開放資料授權碼**（雨天模式自動切換、天候風險 AI） | https://opendata.cwa.gov.tw 註冊登入 →「取得授權碼」→ `.env` 加一行 `CWA_API_KEY=...` | ✅ 完成（2026-10-20，格式與 API 呼叫皆驗證） |
| 3 | **GitHub 遠端倉庫**（課程要求） | 使用者決定公開 → 已建立 https://github.com/DHKGOD/traffic-safety-app 並推送 main（推送前已掃描歷史：無 .env、無金鑰、無大檔） | ✅ 完成（2026-10-20） |
| 4 | **在手機開啟「靈動島懸浮提醒」**（背景守護在其他 App 上顯示提醒） | App →「設定」→「靈動島懸浮提醒」→ 系統頁面開啟「路口安全通」。（測試期間我已用 adb 暫時開啟；通知、定位權限也是用 adb 授予，正式展示前建議在手機上重新確認一次） | 已用 adb 開啟（測試用） |
| 5 | （選用）三星通知彈出樣式 | 手機「設定 → 通知 → 通知彈出樣式」改「詳細」，系統通知也會彈出完整橫幅；不改也沒關係，靈動島會提醒 | 選用 |
| 6 | （選用）Google 地圖底圖 | 需 Google Cloud 綁信用卡（付費）；目前用免費 OpenFreeMap 向量地圖，不需要 | 不需要 |

## 目前階段與整體進度

- ✅ 階段 0 環境、✅ 階段 1 資料庫、✅ 階段 2 App（S21 FE 實機驗收通過）
- ✅ UI 第二版（Apple 地圖版面、iOS 動作表、Android 實色材質）
- ✅ 自訂路線規劃（地名搜尋＋OSRM，例：台北車站→苗栗車站 104 km、47 個危險路口）
- ✅ 座標品質檢查（排除 5,999 件共用預設座標＋996 件座標與地址不符）
- ✅ AI 肇因預測（時間切分、基準比較、model_version／prediction 可回查）＋報告頁「AI 情境預測」
- ✅ Codex 交叉審查第 1 次（5 項全部修正）
- ✅ 背景守護模式（前景服務＋提醒邏輯＋靈動島懸浮提醒＋語音震動；實機驗證：App 在背景時桌面上跳出提醒）
- ✅ 家人模式（分享代碼存資料庫 shared_route、常用路線、長輩模式）
- ✅ App 圖示與啟動畫面、平板橫式版面（Playwright 1280×800 檢查）
- ✅ Codex 撰寫匯入腳本單元測試 tests/test_import.py（Claude 審查後 commit）；Codex 發現 to_int("inf") 會中斷匯入 → 已修正，to_float 也排除 inf/nan
- ✅ Codex 交叉審查第 2、3 次（合計 12 項，11 項成立已修正，1 項經查證不成立）
- ✅ 危險路口合併改良（同一路口被格線切開的問題）
- ✅ 氣象署天候自動模式（`/api/weather/now`：O-A0002-001 最近雨量站＋F-D0047 鄉鎮 3 小時降雨機率；地圖／排行的天候膠囊多「自動」）
- ✅ 地圖改 Google 地圖風格（頂部浮動搜尋列＋膠囊、右側圓鈕）；抽屜四段、最小只剩標題列，觸控拖曳不再被清單吃掉
- ✅ 排行改「附近（GPS）／全國／自訂（記在手機）」＋搜尋行政區或地點；附近範圍選擇 500m–5km（小地圖＋危險點，不顯示路名）；新增 `/api/hotspots/areas`
- ✅ 模擬行走接近路口時跳靈動島／系統通知；按主畫面鍵會交給原生服務在背景繼續、回來接續進度
- ✅ 導航護航：守護中離開 App 時畫面邊緣常駐浮動小圖示（最近路口距離，接近時變紅跳動）；守護選單一鍵開 Google 地圖導航
- ✅ 設定「危險通知」（提醒方式／等級／時機／語音／提示音／震動，同步原生服務）與「開發者選項」（模擬行走、背景守護模擬、導航護航模擬、停止、權限狀態）
- ⬜ 實機驗證背景守護模擬與導航護航小圖示（`scripts/background_alert_test.py bg|nav`，需手機解鎖）
- ⬜ AI 任務 2：天候風險用測站降雨時數校正

## 最後完成的事情

| commit | 內容 |
|---|---|
| `14511b8` | 地圖頁改 Apple 地圖風格（浮動卡片抽屜、天氣膠囊顯示氣溫、路線摘要、快捷圓鈕）；修正 Codex 第 4 次審查 3 項 |
| `f88e7f7` | 開發者選項背景模擬加快 3 倍；實機背景提醒測試腳本 |
| `23c8537` | 設定「危險通知」「開發者選項」；排行附近範圍選擇（小地圖）與排版；模擬行走出錯不再卡住 |
| `33766bf` | 地圖 Google 地圖風格、抽屜最小化；排行附近／全國／自訂＋搜尋；模擬行走跳通知可背景執行；導航護航浮動小圖示 |
| `646d51f` | 天候自動模式（氣象署最近雨量站＋鄉鎮降雨機率） |
| `b04faf1` | 實機測試腳本：先喚醒螢幕，鎖定時給出提示 |
| `15aa759` | 修正 Codex 第三次審查：分享代碼防暴力猜測、E2E 只清自己的資料、守護中切換長輩模式即時生效、路口合併結果固定 |
| `2e02eb7` | README：功能總覽與測試方法 |
| `f99adb7` | 危險路口彙整改良：合併被格線切開的相鄰格子（不連鎖合併）＋單元測試；更新筆數報告 |
| `b136bfc` | 匯入腳本單元測試（由 Codex 撰寫、Claude 審查）；修正 Codex 發現的 to_int('inf') 例外，to_float 排除 inf/nan |
| `ef71fb3` | 更新 HANDOFF 進度 |
| `a5d048e` | 隱藏捲軸（iOS 風格）；平板橫式版面檢查 |
| `f177d74` | 家人模式（分享路線代碼存資料庫、常用路線、長輩模式：大字＋提早提醒＋慢速語音＋AI 預設長輩）；E2E 16 項、Java 測試 7 項；更新 ER 圖與任務 |
| `3e74c83` | 修正 Codex 第二次審查：服務被系統重啟時恢復定位、Android 7 震動相容；實機測試腳本略過不完整截圖 |
| `3f43567` | App 圖示與啟動畫面（iOS 風格紅色警示圖示、深淺色啟動畫面） |
| `37ccc58` | 背景守護模式：靈動島懸浮提醒（不受三星簡要通知影響）、通知分組修正、實機測試腳本；更新 HANDOFF 與決策紀錄 |
| `bba487b` | 修正 Codex 審查 5 項（自動建置前端、初始化步驟可續做、自動訓練模型、健康檢查含資料庫、設定頁顯示正確模型）；背景守護模式原生外掛（前景服務、提醒邏輯、Java 單元測試）與 App 介面 |

## 進行中的工作

- **App 內更新（GitHub Releases）先擱置、未 commit**：`frontend/package.json`（0.2.0）、`build.gradle`（版本號讀 package.json）、`AndroidManifest`（REQUEST_INSTALL_PACKAGES）、`MainActivity`（註冊 AppUpdatePlugin）、`update/AppUpdatePlugin.java`。使用者說「先保留、不要 commit 也不要還原，等我決定」。**commit 時只 add 指定檔案，不要 `git add -A`**；打包 APK 時用乾淨的 git worktree（scratchpad 的 apkbuild）避免把這些未決定的修改包進去。

## 下一步（可直接開始）

1. **手機解鎖後實機驗證背景提醒**：`uv run python scripts/background_alert_test.py bg 50`（背景守護模擬）與 `... nav 50`（導航護航＋Google 地圖），看 `logs/background_test/` 截圖有靈動島與護航小圖示、輸出「送出的危險路口提醒」≥1；再跑 `uv run python scripts/phone_tour.py`。
2. **AI 任務 2（天候風險校正）**（天候自動模式已完成；氣象署 API 格式實測紀錄見 `backend/app/routers/weather.py` 開頭與 FORECAST_DATASET）：先查氣象署有無 2026 年逐日／逐時雨量的 API 資料集（不要憑記憶猜，實際呼叫確認）；取得測站每日／每小時雨量，計算各行政區「下雨時數占比」，雨天風險倍數 = (雨天事故占比) ÷ (下雨時數占比)，取代全國雨天比例；結果寫進 hotspot 或新表，報告頁顯示「下雨時事故風險是平常的 N 倍」。
3. （選用）背景守護改進：Activity Recognition 區分搭車與開車（需 ACTIVITY_RECOGNITION 權限）。
4. （選用）錄 Demo 影片：S21 FE 螢幕錄影「規劃路線 → 開背景守護模擬 → 切到 Google 地圖 → 靈動島提醒跳出」。

## 已知問題與注意事項

- **三星「通知彈出樣式：簡要」會停用一般 App 的彈出橫幅**（系統日誌 DISABLE_HEADS_UP）→ 背景守護改用自己畫的靈動島懸浮視窗（SYSTEM_ALERT_WINDOW），有權限時系統通知改為靜音紀錄。
- **Gradle 單元測試在中文路徑下載入不到類別** → 用 scripts/test_guardian.ps1 在英文暫存路徑以 javac＋JUnit 執行。
- **S21 FE 的 WebView 開 backdrop-filter 會把底下內容半透明重疊畫出**（不是正常模糊）。App 內（`html.no-blur`）一律關閉毛玻璃改實色；電腦瀏覽器仍有毛玻璃。
- **專案路徑含中文**：PostgreSQL 程式裝在 `%LOCALAPPDATA%\Programs\pgsql18`；Gradle 用 `android.overridePathCheck=true`。
- **防毒攔截 TLS**：Python truststore、`UV_SYSTEM_CERTS=1`、Gradle Windows-ROOT（已處理）。
- **Claude 桌面版 AppData 虛擬化**：Android SDK 放 `%USERPROFILE%\Android\Sdk`。
- **.ps1 存 UTF-8 含 BOM**。
- Claude 內建瀏覽器沒有 WebGL（MapLibre 底圖空白），用 Playwright 或手機測試。
- `adb reverse tcp:8000 tcp:8000` 在手機重新插拔後要重跑。
- 危險路口格網法：跨格線的路口會拆成兩格（例：中正路／思源路出現兩次）。TASKS 有改進項。
- AI 模型檔（*.joblib，約 7 MB）不進 Git，用 `uv run python ai/train_cause_model.py` 重建；中繼資料 *.json 有進 Git。
- 9–10 月測試資料只有 9 月整月＋10 月前半（資料提供到 115/10/16）。

## 如何驗證目前成果

| 驗證 | 指令 | 預期結果 |
|---|---|---|
| 啟動 | 雙擊 `start_server.bat` | 印出本機與區網網址 |
| 筆數 | `uv run python scripts/db_report.py` | accident 284,116；party 640,620 |
| 後端測試 | `uv run pytest` | 48 passed |
| 端對端測試 | `powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1` | 23 passed（約 3.5 分鐘） |
| 實機巡檢 | 手機接 USB（或同 Wi-Fi）、`uv run python scripts/phone_tour.py` | 23 步驟、JS 錯誤 0，截圖在 `logs/phone_tour/` |
| 背景提醒實機 | `uv run python scripts/background_alert_test.py bg 50`（或 `nav`） | 送出的危險路口提醒 ≥1，截圖在 `logs/background_test/` |
| 守護邏輯 | `powershell -ExecutionPolicy Bypass -File scripts\test_guardian.ps1` | OK (8 tests) |
| 守護實機 | 手機接 USB、`uv run python scripts/guardian_device_test.py 60` | 收到提醒且偵測到靈動島截圖（logs/guardian_test/banner_*.png） |
| AI | `uv run python ai/train_cause_model.py`（約 2 分鐘） | 產生 `docs/ai-report.md`，model_version 有兩筆 is_active |
| APK | `powershell -ExecutionPolicy Bypass -File scripts\build_apk.ps1` | `dist/traffic-safety-debug.apk`，有接手機則自動安裝 |
| MCP | `uv run python scripts/verify_mcp.py` | 三個 [OK] |

## 交叉審查紀錄

### 第 1 次（2026-10-20，Codex review，範圍 e785c0c..256f30f）

| # | Codex 指出 | 判斷 | 處理 |
|---|---|---|---|
| 1 | 全新環境沒有 frontend/dist，首頁 404 | 成立 | server.py 啟動時自動 npm ci＋build（找不到 Node 時提示） |
| 2 | 匯入後的步驟失敗，下次啟動不會補做 | 成立 | 啟動時逐一檢查：匯入批次數、座標檢查、危險路口數，缺哪步補哪步 |
| 3 | 全新環境沒有 AI 模型，預測 503 | 成立 | 啟動時偵測 cause_scenario 模型檔，沒有就自動訓練 |
| 4 | 測試連線時資料庫異常仍判定成功 | 成立 | testServer 檢查 status 與 database.ok；E2E 加測 |
| 5 | 設定頁顯示的模型可能是對照模型 | 成立 | 改為指定 cause_scenario；E2E 加測 |

驗證：刪除危險路口、前端 dist、模型檔後執行一鍵啟動，三者皆自動重建；E2E 15/15。

### 第 2 次（2026-10-20，Codex review，範圍 256f30f..3f43567：背景守護模式）

| # | Codex 指出 | 判斷 | 處理 |
|---|---|---|---|
| 1 | START_STICKY 重啟時 intent 為 null，服務顯示守護中卻沒在定位 | 成立 | 從 SharedPreferences 恢復交通方式並重新定位；展示模擬則直接結束 |
| 2 | Location.hasSpeed() 在 API 24–25 不存在 | **不成立**：hasSpeed() 自 API 1 即有（API 26 新增的是 getSpeedAccuracyMetersPerSecond）；Android Lint NewApi 檢查 0 錯誤 | 不改 |
| 3 | VibrationEffect 在 API 24–25 不存在（且 NoClassDefFoundError 不會被 catch Exception 接住） | 成立 | API < 26 改用 Vibrator.vibrate(long[], int) |

驗證：Java 單元測試 6/6、Android Lint 0 錯誤、實機守護測試出現靈動島提醒。

### 第 3 次（2026-10-20，Codex review，範圍 3e74c83..2e02eb7：家人模式、路口合併）

| # | Codex 指出 | 判斷 | 處理 |
|---|---|---|---|
| 1 | 分享代碼可被無限次猜測 | 成立 | 同一來源 10 分鐘內猜錯 10 次就回 429；格式不符直接算失敗；pytest 加測 |
| 2 | E2E 清理以起訖點判斷，可能誤刪真實分享 | 成立 | E2E 記錄產生的代碼到 test-results/e2e-codes.txt，清理只刪這些 |
| 3 | 守護中切換長輩模式不會生效 | 成立 | guardian.js 監聽 elder 事件，執行中（非模擬）自動重啟服務 |
| 4 | 事故數相同的格子合併順序不固定 | 成立 | 排序加上座標作為固定依據 |

驗證：pytest 45/45、E2E 16/16、實機巡檢 JS 錯誤 0。

### 第 4 次（2026-10-20，Codex review，範圍 4b312ae..847f297：天候自動、地圖／排行改版、背景模擬、危險通知設定）

| # | Codex 指出 | 判斷 | 處理 |
|---|---|---|---|
| 1 | 氣象署時間字串沒有時區時與有時區的現在時間比較會例外，`/api/weather/now` 500 | 成立 | `_ts()` 沒有時區時視為台灣時間；pytest 加測 |
| 2 | 開 App 的天氣請求進行中時選「自動」，會拿到 null 被當成失敗而關掉自動 | 成立 | 共用進行中的請求，完成時依最新自動模式套用（只提示一次） |
| 3 | 只用靈動島時通知走靜音頻道，「提示音」設定無效 | 成立 | 只用靈動島且開提示音時由 App 播系統通知音（導航提示用途） |

驗證：pytest 48/48、E2E 23/23（commit `14511b8`）。實機尚未驗證（手機鎖定）。

# HANDOFF 交接

> 每完成一個小任務、或對話快滿／額度快到時，都要更新本檔並 commit。接手方先讀 AGENTS.md、本檔、TASKS.md。

## 🔴 待我處理（只有使用者能做）

| # | 事項 | 怎麼做 | 狀態 |
|---|---|---|---|
| 1 | **Windows 防火牆開放 TCP 8000**（手機走 Wi-Fi 連電腦需要；目前用 USB `adb reverse` 代替） | 系統管理員 PowerShell：`New-NetFirewallRule -DisplayName "交通安全App API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -RemoteAddress LocalSubnet -Action Allow -Profile Any`，之後 App 設定頁改成 `192.168.1.108:8000` | 未完成 |
| 2 | **氣象署開放資料授權碼**（雨天模式自動切換、天候風險 AI） | https://opendata.cwa.gov.tw 註冊登入 →「取得授權碼」→ `.env` 加一行 `CWA_API_KEY=...` | 未完成 |
| 3 | **GitHub 遠端倉庫**（課程要求） | 決定公開或私人：`gh repo create traffic-safety-app --private --source . --push` | 未完成 |
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
- ⬜ 氣象署雨天模式（需授權碼）

## 最後完成的事情

| commit | 內容 |
|---|---|
| （本次） | AI 肇因預測（模型 A 對照 acc 0.537／macro-F1 0.526；模型 B 情境 acc 0.361／macro-F1 0.314／top-3 0.683，基準 0.242／0.039／0.475）、AI API 與報告頁情境預測、E2E 14 項 |
| `3228248` | 忽略 Playwright 測試輸出 |
| `4415c98` | UI 第二版、自訂路線、座標品質檢查、E2E、實機巡檢腳本 |
| `ce67e8e` | 文件：README、HANDOFF、TASKS、ER 圖、決策、雲端部署、接力說明 |
| `89a160c` | 前端 App 與 Android 專案；階段 2 驗收 |

## 進行中的工作

無（本段落空白代表可以直接從「下一步」開始）。

## 下一步（可直接開始）

1. **Codex 交叉審查**：`node "%USERPROFILE%\.claude\plugins\marketplaces\openai-codex\plugins\codex\scripts\codex-companion.mjs" review --base e785c0c`（或在 Claude Code 用 `/codex:review --base e785c0c`），修正合理問題，記錄在下方「交叉審查紀錄」。
2. **背景守護模式**（使用者提議，價值最高）：Capacitor 自寫 Android 外掛（Kotlin）
   - 前景服務＋常駐通知「守護中」；Geofencing 註冊附近 100 個危險路口（離開範圍時重新註冊）
   - Activity Recognition：走路／騎車／開車 → 提醒距離 50／150／250 m；搭車（公車、捷運）時靜音
   - heads-up 通知＋TTS 語音（壓低 Google Maps 音量）＋震動；方向判斷與冷卻時間
   - 危險路口資料快取在手機（新北市），離線可用
   - 權限：ACCESS_BACKGROUND_LOCATION、POST_NOTIFICATIONS、FOREGROUND_SERVICE_LOCATION、ACTIVITY_RECOGNITION
3. 氣象署（拿到授權碼後）：即時觀測＋鄉鎮預報 → 自動雨天模式；用測站降雨時數校正「雨天風險倍數」（AI 任務 2）。

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
| 後端測試 | `uv run pytest` | 43 passed |
| 端對端測試 | `powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1` | 16 passed（約 2 分鐘） |
| 實機巡檢 | 手機接 USB、`adb reverse tcp:8000 tcp:8000`、`uv run python scripts/phone_tour.py` | 20 步驟、JS 錯誤 0，截圖在 `logs/phone_tour/` |
| 守護邏輯 | `powershell -ExecutionPolicy Bypass -File scripts\test_guardian.ps1` | OK (7 tests) |
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

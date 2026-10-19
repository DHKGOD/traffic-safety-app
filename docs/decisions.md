# 技術決策紀錄

每項決策：日期、決定、理由、替代方案。新的決策加在最下面。

## 2026-10-20 環境

| # | 決定 | 理由 | 替代方案（未採用原因） |
|---|---|---|---|
| D1 | **不用 Docker**；PostgreSQL 用 EnterpriseDB 官方免安裝版 zip ＋ OSGeo 官方 PostGIS bundle | 不需系統管理員、不建 Windows 服務；資料目錄可放專案內（`db/pgdata`），符合「模擬雲端」 | Docker Desktop 需管理員、WSL2，且資料目錄在 volume 中不直觀 |
| D2 | PostgreSQL 程式裝在 `%LOCALAPPDATA%\Programs\pgsql18`，**資料目錄仍在專案內** | Windows 版 initdb 會把 share 目錄路徑寫進 SQL，專案路徑含中文（桌面、資料庫專題）會失敗（invalid byte sequence 0xae） | 把專案搬到英文路徑（要動使用者資料夾）、8.3 短路徑（E: 未啟用） |
| D3 | Android SDK 放在 `%USERPROFILE%\Android\Sdk` | Claude 桌面版是 MSIX 封裝，寫進 AppData 的檔案會被虛擬化到私有目錄，其他程式看不到 | `%LOCALAPPDATA%\Android\Sdk`（被虛擬化） |
| D4 | JDK 21（Microsoft Build of OpenJDK） | Capacitor 8 / AGP 需要 JDK 21 | 既有 JDK 17/23 版本不符 |
| D5 | Python 用 uv 管理（`pyproject.toml` + `uv.lock`） | 快、可重現、雲端主機只要裝 uv | pip + venv |
| D6 | 本機有防毒軟體攔截 TLS：Python 用 `truststore`、uv 用 `UV_SYSTEM_CERTS=1`、Gradle 用 `-Djavax.net.ssl.trustStoreType=Windows-ROOT` | 使用 Windows 憑證庫即可，不必關防毒 | 關閉 TLS 驗證（不安全） |

## 2026-10-20 MCP / 外掛

| # | 決定 | 理由 |
|---|---|---|
| M1 | Context7（Upstash 官方）讀最新文件 | FastAPI、Capacitor、Leaflet、MapLibre 版本更新快 |
| M2 | Playwright MCP（Microsoft 官方）測網頁 | 可在標準 Chromium 驗證 WebGL 地圖（Claude 內建瀏覽器沒有 WebGL） |
| M3 | **自寫唯讀 Postgres MCP**（`tools_mcp/pg_readonly_mcp.py`，官方 MCP Python SDK） | 第三方 `postgres-mcp` 與 mcp 2.x、pglast 版本不相容，試了 3 種方法都裝不起來；自寫只有 60 行、可控，且用 `mcp_readonly` 帳號＋ READ ONLY 交易雙重保護 |
| M4 | GitHub 不裝 MCP，用已登入的 `gh` CLI | gh 已可建 repo、PR、issue；官方 GitHub MCP 需要另外的 PAT |
| M5 | OpenAI 官方 `codex-plugin-cc` + Codex CLI | 使用者要求 Claude／Codex 接力與交叉審查 |

## 2026-10-20 資料與資料庫

| # | 決定 | 理由 |
|---|---|---|
| B1 | 資料：115 年 1–10 月 A2（即時資料集 13139） | 284,116 件事故／640,620 列，遠超 20 萬；1–8 月筆數與先前實測完全一致 |
| B2 | 不匯入 110 年 A1 歷史檔 | 該檔只有 6 欄，格式與 A2 不同；下載腳本保留 `--with-a1` 選項 |
| B3 | 事故切分規則：「當事者順位=1」開新事故 | 原始資料沒有事故編號；用(日期,時間,地點,座標)當鍵會有 31 件碰撞 |
| B4 | `party` 不設 (accident_id, party_order) UNIQUE | 原始資料有 1 件事故順位為 1,2,4,4，保留原貌 |
| B5 | 無效座標（台灣範圍外，如緯度 9）保留原值、`coord_valid=false` | 不丟資料，空間查詢只用有效座標（283,785 件） |
| B6 | 危險路口＝路口事故以 0.0004°（約 40 m）格網彙整、至少 3 件 | 一般 SQL 即可、可解釋；已知限制：路口剛好跨格線時會被拆成兩格（TASKS 有改進項） |
| B7 | PostGIS 欄位用「產生欄位」(GENERATED ... STORED) | lon/lat 改變自動更新；沒有 PostGIS 的主機直接略過 002 migration |
| B8 | Migration 用自寫的簡單 runner（`scripts/migrate.py` + 編號 SQL 檔） | 透明、無額外套件、任何 PostgreSQL 都能跑 |
| B9 | 資料庫只聽 localhost；手機連 API 不連 DB | 安全；上雲端時也建議 DB 不對外 |

## 2026-10-20 前端與 App

| # | 決定 | 理由 |
|---|---|---|
| F1 | Vite + 原生 JS（不用 React） | 畫面數量不多；套件少、打包小、Codex 也容易接手 |
| F2 | iOS 設計語言：毛玻璃導覽列／分頁列、大標題、圓角分組清單、分段控制、底部抽屜、深色模式 | 使用者要求「像 Apple App 一樣好看」 |
| F3 | 底圖：**MapLibre GL 向量地圖 + OpenFreeMap**（Liberty／Dark 樣式），透過 maplibre-gl-leaflet 與 Leaflet 標記共存 | 免金鑰、免費、開源；風格接近 Google 地圖。CARTO 已需 API key；Google Maps 官方 API 需綁信用卡（付費服務，需使用者決定）；直接抓 Google 圖磚違反條款 |
| F4 | 地名顯示 `name:zh-Hant` → `name` | 台灣的 `name` 本身是繁體，`name:zh` 常是簡體 |
| F5 | Capacitor `androidScheme: http` ＋ network_security_config 允許明文 | 本機階段手機用 http 連區網 IP（IP 會變，無法逐一列出）；上雲端改 HTTPS 後可關閉 |
| F6 | 伺服器位址存在 App 的 localStorage，設定頁可改、輸入會自動把全形符號轉半形 | 換雲端不必重新打包；中文輸入法常打出全形「：」 |
| F7 | 即時回報用 `since_id` 每 5 秒輪詢（不用 WebSocket） | 簡單、穿過任何代理／雲端主機都能用 |

## 2026-10-20 產品方向（使用者提議）

| # | 決定 | 理由 |
|---|---|---|
| P1 | 規劃「背景守護模式」：Geofencing ＋ 活動辨識 ＋ heads-up 通知 ＋ 語音（自寫 Capacitor Android 外掛） | 使用者實際用 Google Maps 導航或在通勤時滑手機，不會一直開著本 App；背景提醒才是最大價值 |
| P2 | 自訂起訖點路線（地名搜尋 Nominatim、路線 OSRM，由後端代查） | 使用者要能查「台北到苗栗」等任意路線 |

# 搬到雲端主機的步驟（通用流程）

老師提供的主機型態未知（可能是 Linux VM、Windows VM、或只給資料庫＋容器平台）。本專案的設計讓搬遷只需要：**裝工具 → 放程式 → 改 `.env` → 跑重建腳本 → 啟動**。

## 0. 先確認主機提供什麼

| 問題 | 影響 |
|---|---|
| 作業系統（Linux / Windows）？有沒有 sudo／系統管理員？ | 決定用 `start_server.sh` 或 `.bat`、能否自己裝 PostgreSQL |
| 有沒有現成的 PostgreSQL？版本？有沒有 PostGIS？ | 有 → `DB_MODE=external`；沒有 PostGIS 也能跑（自動改用一般 SQL） |
| 對外開放哪些 port？有沒有網域與 HTTPS？ | 決定 API 位址、是否需要反向代理（nginx/Caddy） |
| 主機規格（記憶體、磁碟） | 資料庫約 600 MB，原始檔約 30 MB；1 GB RAM 以上即可 |

## 1. 安裝基本工具

Linux（Ubuntu/Debian 為例）：

```bash
sudo apt update && sudo apt install -y git curl
curl -LsSf https://astral.sh/uv/install.sh | sh        # Python 套件管理（會自動下載 Python 3.11+）
# 若要自己架資料庫：
sudo apt install -y postgresql postgresql-contrib postgis
```

Windows 主機：安裝 Git、uv，再執行 `scripts\install_postgres.ps1`（免安裝版 PostgreSQL＋PostGIS）。

## 2. 取得程式

```bash
git clone <GitHub 倉庫網址> traffic-safety
cd traffic-safety
```

## 3. 設定 `.env`

```bash
cp .env.example .env
```

依情況修改：

| 情境 | 設定 |
|---|---|
| 主機上自己架 PostgreSQL（Linux 套件安裝） | `DB_MODE=external`，`POSTGRES_HOST=127.0.0.1`，填好超級使用者密碼 |
| 主機提供資料庫服務 | `DB_MODE=external`，`DATABASE_URL` 改成服務給的連線字串（例如 `postgresql://user:pw@db.example.edu.tw:5432/traffic`） |
| Windows 主機、想沿用「專案內資料庫」 | `DB_MODE=local`（與本機相同） |
| 對外網址 | `PUBLIC_API_BASE=https://你的網域` |
| 前端來源限制 | `CORS_ORIGINS=https://你的網域,http://localhost`（App 的 WebView 來源是 `http://localhost`） |

**密碼只寫在主機上的 `.env`，不要 commit。**

## 4. 建資料庫與匯入資料

```bash
uv run python scripts/rebuild_db.py --download
```

會依序：（local 模式啟動資料庫）→ 建帳號與 PostGIS → migration → 下載原始資料 → 匯入 → 建危險路口 → 印出筆數報告（`docs/db-report.md`）。

- 主機**沒有超級使用者權限**：請管理員先執行下列 SQL，再加 `--skip-bootstrap`：
  ```sql
  CREATE ROLE traffic_app LOGIN PASSWORD '...';
  CREATE DATABASE traffic OWNER traffic_app;
  \c traffic
  CREATE EXTENSION IF NOT EXISTS postgis;   -- 沒有 PostGIS 可省略
  ```
- **搬移使用者回報**（本機已有的資料）：
  ```bash
  pg_dump -t user_report -t model_version -t prediction --data-only traffic > reports.sql   # 在本機
  psql "$DATABASE_URL" -f reports.sql                                                        # 在主機
  ```

## 5. 訓練／放置 AI 模型

```bash
uv run python ai/train_cause_model.py      # 重新訓練並寫入 model_version
```

（或把本機 `ai/models/` 下的模型檔複製過去，並匯出 `model_version` 資料。）

## 6. 啟動

```bash
./start_server.sh        # Linux；Windows 用 start_server.bat
```

長期執行建議用 systemd（Linux）：

```ini
# /etc/systemd/system/traffic-api.service
[Service]
WorkingDirectory=/home/<user>/traffic-safety
ExecStart=/home/<user>/.local/bin/uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always
[Install]
WantedBy=multi-user.target
```

## 7. HTTPS（建議）

用 Caddy 最簡單（自動申請憑證）：

```
traffic.example.edu.tw {
    reverse_proxy 127.0.0.1:8000
}
```

改用 HTTPS 後，可把 `frontend/android/app/src/main/res/xml/network_security_config.xml` 的 `cleartextTrafficPermitted` 改成 `false` 再打包。

## 8. App 改連雲端

不用重新打包：打開 App →「設定」→ 伺服器位址輸入 `https://traffic.example.edu.tw` →「測試並儲存」。

## 9. 驗證清單

- [ ] `curl https://<網址>/api/health` → `"status":"ok"`
- [ ] `docs/db-report.md` 的事故件數 284,116、當事人 640,620（或更新後的數字）
- [ ] 瀏覽器開 `https://<網址>/` 看得到地圖與危險路口
- [ ] 手機新增回報 → 主機上 `SELECT * FROM user_report ORDER BY id DESC LIMIT 1;` 查得到

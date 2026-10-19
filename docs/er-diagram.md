# 資料表關係（ER 圖）

> 由 `migrations/001_core.sql` 建立；PostGIS 版本另由 `002_spatial.postgis.sql` 加上 `geom` 產生欄位。
> GitHub 會直接把下面的 Mermaid 畫成圖。

```mermaid
erDiagram
    import_batch ||--o{ accident : "匯入"
    accident ||--|{ party : "一件事故有多位當事人"
    cause_code ||--o{ accident : "主要肇因"
    cause_code ||--o{ party : "個別肇因"
    collision_type ||--o{ accident : "事故型態"
    hotspot ||--o{ accident : "歸屬路口"
    hotspot ||--o{ user_report : "附近回報"
    hotspot ||--o{ prediction : "預測對象"
    model_version ||--o{ prediction : "哪一版模型"
    shared_route {
        bigserial id PK
        char code UK
        text name
        text mode
        jsonb points
        bool for_elder
        timestamptz expires_at
    }

    import_batch {
        serial id PK
        text source_file
        char sha256
        int accident_rows
        int party_rows
    }
    accident {
        bigserial id PK
        int batch_id FK
        timestamp occurred_at
        smallint hour
        text city
        text district
        text weather
        text light
        text road_type_major
        text signal_type
        int collision_type_id FK
        int main_cause_id FK
        smallint injuries
        float lon
        float lat
        bool coord_valid
        int hotspot_id FK
        geography geom "PostGIS 時才有"
    }
    party {
        bigserial id PK
        bigint accident_id FK
        smallint party_order
        text vehicle_major
        text sex
        smallint age
        text phone_use
        int cause_id FK
        bool hit_and_run
    }
    cause_code {
        serial id PK
        text major
        text minor
    }
    collision_type {
        serial id PK
        text major
        text minor
    }
    hotspot {
        serial id PK
        text cell_key UK
        text name
        text district
        float lon
        float lat
        int accident_count
        int rain_count
        int night_count
        float risk_score
    }
    user_report {
        bigserial id PK
        timestamptz created_at
        float lon
        float lat
        text category
        text description
        text device_id
        int hotspot_id FK
    }
    model_version {
        serial id PK
        text name
        text version
        jsonb metrics
        jsonb baseline
        bool is_active
    }
    prediction {
        bigserial id PK
        int model_version_id FK
        int hotspot_id FK
        jsonb input
        jsonb output
    }
```

## 設計重點

| 項目 | 說明 |
|---|---|
| 事故 vs 當事人 | 原始 CSV 一列是一位當事人；「當事者順位=1」開始一件新事故。事故層級欄位存在 `accident`，每一列都存在 `party`。 |
| 代碼正規化 | 肇因（大類＋子類）與事故型態另建 `cause_code`、`collision_type`，事故與當事人用外鍵參照。 |
| 路口（熱點） | `hotspot` 由 `scripts/build_hotspots.py` 依約 40 公尺格網彙整路口事故而成，`accident.hotspot_id` 回填歸屬。 |
| 可追溯 | `import_batch` 記錄每個原始檔與 SHA-256；`prediction.model_version_id` 讓每次 AI 預測都能回查模型版本。 |
| 家人模式 | `shared_route` 存子女分享給長輩的路線（6 碼代碼、30 天有效），長輩手機用代碼下載；獨立資料表，不與事故資料關聯。 |
| 座標品質 | `accident.coord_flag` 記錄座標不可用的原因（out_of_taiwan／shared_default／far_from_district）。 |
| 可移植 | 一般欄位 `lon/lat` 永遠存在；有 PostGIS 才加 `geom`（產生欄位＋GiST 索引），沒有時 API 改用 haversine 公式。 |

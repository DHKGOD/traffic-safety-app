-- 001 核心資料表（一般 SQL，不依賴 PostGIS）
-- 事故 accident 1 ── N 當事人 party；事故 N ── 1 肇因代碼 cause_code、事故型態 collision_type、路口 hotspot

-- 匯入批次：記錄每個原始檔，方便追溯資料來源
CREATE TABLE import_batch (
    id            serial PRIMARY KEY,
    source_file   text        NOT NULL,           -- 例如 data/raw/a2_115/115_NPA_TMA2_01.zip
    sha256        char(64)    NOT NULL,
    dataset_id    integer,                        -- data.gov.tw 資料集編號
    accident_rows integer     NOT NULL DEFAULT 0, -- 事故件數
    party_rows    integer     NOT NULL DEFAULT 0, -- 當事人列數（原始 CSV 列數）
    imported_at   timestamptz NOT NULL DEFAULT now()
);

-- 肇因代碼（大類／子類），主要肇因與個別肇因共用
CREATE TABLE cause_code (
    id     serial PRIMARY KEY,
    major  text NOT NULL,     -- 肇因研判大類別名稱
    minor  text NOT NULL,     -- 肇因研判子類別名稱
    UNIQUE (major, minor)
);

-- 事故類型及型態（大類／子類）
CREATE TABLE collision_type (
    id     serial PRIMARY KEY,
    major  text NOT NULL,     -- 車與車、人與車、車輛本身
    minor  text NOT NULL,     -- 側撞、追撞…
    UNIQUE (major, minor)
);

-- 路口或區塊（熱點）：由匯入後的 build_hotspots 依座標格網彙整
CREATE TABLE hotspot (
    id              serial PRIMARY KEY,
    cell_key        text UNIQUE NOT NULL,   -- 格網編號 "x:y"
    name            text NOT NULL,          -- 最常見的發生地點描述（例如「中正路 / 民安路」）
    city            text,
    district        text,
    lon             double precision NOT NULL,
    lat             double precision NOT NULL,
    is_intersection boolean NOT NULL DEFAULT true,
    accident_count  integer NOT NULL DEFAULT 0,
    injury_count    integer NOT NULL DEFAULT 0,
    death_count     integer NOT NULL DEFAULT 0,
    rain_count      integer NOT NULL DEFAULT 0, -- 天候=雨 的事故件數
    night_count     integer NOT NULL DEFAULT 0, -- 18:00–05:59 的事故件數
    risk_score      double precision NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hotspot_lat_lon_idx ON hotspot (lat, lon);
CREATE INDEX hotspot_risk_idx ON hotspot (risk_score DESC);

-- 事故（一件事故一列；原始資料中「當事者順位=1」那列的事故層級欄位）
CREATE TABLE accident (
    id                 bigserial PRIMARY KEY,
    batch_id           integer NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
    accident_class     varchar(2) NOT NULL,           -- A1 / A2
    occurred_at        timestamp NOT NULL,            -- 發生日期＋時間（台灣時間）
    year               smallint NOT NULL,
    month              smallint NOT NULL,
    hour               smallint NOT NULL,
    weekday            smallint NOT NULL,             -- 0=週一 … 6=週日
    police_unit        text,                          -- 處理單位名稱警局層
    location_text      text,                          -- 發生地點
    city               text,                          -- 由發生地點解析：縣市
    district           text,                          -- 由發生地點解析：鄉鎮市區
    weather            text,                          -- 天候名稱
    light              text,                          -- 光線名稱
    road_class         text,                          -- 道路類別-第1當事者
    speed_limit        smallint,                      -- 速限-第1當事者
    road_type_major    text,                          -- 道路型態大類別
    road_type_minor    text,
    position_major     text,                          -- 事故位置大類別
    position_minor     text,
    surface_pave       text,
    surface_state      text,
    surface_defect     text,
    obstacle           text,
    sight_quality      text,
    sight              text,
    signal_type        text,                          -- 號誌種類
    signal_action      text,
    divider_major      text,
    divider_minor      text,
    lane_fast          text,
    lane_fast_slow     text,
    edge_line          text,
    collision_type_id  integer REFERENCES collision_type(id),
    main_cause_id      integer REFERENCES cause_code(id),
    deaths             smallint NOT NULL DEFAULT 0,
    injuries           smallint NOT NULL DEFAULT 0,
    party_count        smallint NOT NULL DEFAULT 0,
    lon                double precision,
    lat                double precision,
    coord_valid        boolean NOT NULL DEFAULT false, -- 座標是否落在台灣範圍內
    hotspot_id         integer REFERENCES hotspot(id) ON DELETE SET NULL
);
CREATE INDEX accident_lat_lon_idx ON accident (lat, lon) WHERE coord_valid;
CREATE INDEX accident_hotspot_idx ON accident (hotspot_id);
CREATE INDEX accident_occurred_idx ON accident (occurred_at);
CREATE INDEX accident_cause_idx ON accident (main_cause_id);
CREATE INDEX accident_city_idx ON accident (city, district);

-- 當事人（原始 CSV 的每一列）
CREATE TABLE party (
    id                   bigserial PRIMARY KEY,
    accident_id          bigint NOT NULL REFERENCES accident(id) ON DELETE CASCADE,
    party_order          smallint NOT NULL,           -- 當事者順位
    vehicle_major        text,                        -- 車種大類（機車、小客車、人…）
    vehicle_minor        text,
    sex                  text,
    age                  smallint,                    -- -1 / 空白 → NULL
    protection           text,                        -- 保護裝備
    phone_use            text,                        -- 只記錄駕駛人，行人一律「非駕駛人」
    action_major         text,                        -- 當事者行動狀態
    action_minor         text,
    impact_initial_major text,
    impact_initial_minor text,
    impact_other_major   text,
    impact_other_minor   text,
    cause_id             integer REFERENCES cause_code(id), -- 肇因研判-個別
    hit_and_run          boolean
);
-- 不設 UNIQUE：原始資料中有極少數事故的當事者順位重複（例如 115/03 有一件為 1,2,4,4），保留原貌
CREATE INDEX party_accident_idx ON party (accident_id, party_order);

-- 使用者回報「差點被撞」
CREATE TABLE user_report (
    id           bigserial PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    lon          double precision NOT NULL,
    lat          double precision NOT NULL,
    category     text NOT NULL DEFAULT 'near_miss',  -- near_miss / hazard / other
    description  text,
    device_id    text,                               -- App 產生的匿名裝置代碼
    hotspot_id   integer REFERENCES hotspot(id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'open',
    CHECK (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180)
);
CREATE INDEX user_report_created_idx ON user_report (created_at DESC);
CREATE INDEX user_report_lat_lon_idx ON user_report (lat, lon);

-- AI 模型版本
CREATE TABLE model_version (
    id              serial PRIMARY KEY,
    name            text NOT NULL,              -- 例如 cause_predictor
    version         text NOT NULL,              -- 例如 2026.10.20-1
    task            text NOT NULL,              -- 任務說明
    algorithm       text NOT NULL,
    trained_at      timestamptz NOT NULL DEFAULT now(),
    train_range     text,                       -- 例如 115/01–115/06
    test_range      text,
    metrics         jsonb NOT NULL DEFAULT '{}', -- 模型測試結果
    baseline        jsonb NOT NULL DEFAULT '{}', -- 基準測試結果
    artifact_path   text,                       -- 模型檔位置
    is_active       boolean NOT NULL DEFAULT false,
    UNIQUE (name, version)
);

-- 預測紀錄：每次預測都能回查模型版本
CREATE TABLE prediction (
    id                bigserial PRIMARY KEY,
    model_version_id  integer NOT NULL REFERENCES model_version(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    hotspot_id        integer REFERENCES hotspot(id) ON DELETE SET NULL,
    input             jsonb NOT NULL,
    output            jsonb NOT NULL
);
CREATE INDEX prediction_model_idx ON prediction (model_version_id, created_at DESC);

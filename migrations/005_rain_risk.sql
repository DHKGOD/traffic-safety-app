-- 005 AI 任務 2：天候風險校正（ai/rain_risk.py 填入）
-- 用氣象署測站「實際每日雨量」判斷事故當天有沒有下雨，取代事故資料「天候」欄＋全國雨天比例的舊算法
-- （舊算法沒考慮各地下雨天數不同：常下雨的地方，雨天事故比例本來就高）。

-- 氣象署測站（C-B0025-001 有每日雨量的測站；座標取自 O-A0003-001／O-A0001-001）
CREATE TABLE rain_station (
    station_id  text PRIMARY KEY,
    name        text NOT NULL,
    lon         double precision,
    lat         double precision
);

-- 測站每日雨量（mm）；「T」微量記為 0、缺測（空白、X）記為 NULL
CREATE TABLE rain_station_daily (
    station_id  text NOT NULL REFERENCES rain_station(station_id) ON DELETE CASCADE,
    obs_date    date NOT NULL,
    precip_mm   real,
    PRIMARY KEY (station_id, obs_date)
);

-- 各路口：雨天事故占比 vs 同一區預期占比（同區所有事故中，發生在測站雨天的比例）
CREATE TABLE hotspot_rain_risk (
    hotspot_id        integer PRIMARY KEY REFERENCES hotspot(id) ON DELETE CASCADE,
    station_id        text REFERENCES rain_station(station_id) ON DELETE SET NULL,
    accidents         integer NOT NULL,     -- 有雨量資料的事故數
    rainy_accidents   integer NOT NULL,     -- 其中發生在測站雨天（≥ 1 mm）
    expected_share    real NOT NULL,        -- 同區預期雨天占比
    p_value           real NOT NULL,        -- 二項檢定（雙尾）
    level             text NOT NULL,        -- rain_high（雨天顯著偏多）／rain_low（顯著偏少）／normal
    model_version_id  integer REFERENCES model_version(id) ON DELETE SET NULL,
    CHECK (level IN ('rain_high', 'rain_low', 'normal'))
);

-- 004 家人模式：分享路線（子女規劃好路線 → 產生代碼 → 長輩手機輸入代碼下載）
CREATE TABLE shared_route (
    id          bigserial PRIMARY KEY,
    code        char(6) NOT NULL UNIQUE,          -- 分享代碼（不含易混淆字元）
    name        text NOT NULL,                    -- 例如「阿嬤買菜：家 → 市場」
    mode        text NOT NULL DEFAULT 'foot',     -- foot / bike / car
    start_name  text NOT NULL,
    end_name    text NOT NULL,
    points      jsonb NOT NULL,                   -- [[lat, lon], ...]
    distance_m  integer,
    duration_s  integer,
    for_elder   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
    fetch_count integer NOT NULL DEFAULT 0,
    CHECK (mode IN ('foot', 'bike', 'car'))
);
CREATE INDEX shared_route_created_idx ON shared_route (created_at DESC);

-- 002 空間欄位（僅在主機有 PostGIS 時套用；沒有時 API 自動改用一般 SQL 的距離計算）
-- 使用「產生欄位」，由 lon/lat 自動維護，匯入與新增回報都不用另外處理。

ALTER TABLE accident ADD COLUMN geom geography(Point, 4326)
    GENERATED ALWAYS AS (CASE WHEN coord_valid THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography END) STORED;
CREATE INDEX accident_geom_idx ON accident USING gist (geom);

ALTER TABLE hotspot ADD COLUMN geom geography(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;
CREATE INDEX hotspot_geom_idx ON hotspot USING gist (geom);

ALTER TABLE user_report ADD COLUMN geom geography(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;
CREATE INDEX user_report_geom_idx ON user_report USING gist (geom);

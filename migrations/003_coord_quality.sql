-- 003 座標品質：記錄座標被判定為不可用的原因（scripts/clean_coords.py 填入）
--   out_of_taiwan     ：不在台灣範圍（例如緯度 9）
--   shared_default    ：許多不同行政區的事故共用同一個座標（警方系統預設點，例如新北市板橋某點）
--   far_from_district ：座標離地址所屬行政區的中心太遠（例如高雄的事故標在台北）
ALTER TABLE accident ADD COLUMN coord_flag text;
CREATE INDEX accident_coord_flag_idx ON accident (coord_flag) WHERE coord_flag IS NOT NULL;

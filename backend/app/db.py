"""資料庫連線池與 PostGIS 偵測。"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings


class Database:
    def __init__(self) -> None:
        self.pool: ConnectionPool | None = None
        self.postgis = False
        self.risk_q75 = 0.0
        self.risk_q95 = 0.0

    def open(self) -> None:
        self.pool = ConnectionPool(settings.database_url, min_size=1, max_size=10, open=True,
                                   kwargs={"row_factory": dict_row}, timeout=10)
        self.refresh_meta()

    def refresh_meta(self) -> None:
        with self.conn() as c:
            has = c.execute("SELECT 1 AS x FROM pg_extension WHERE extname='postgis'").fetchone() is not None
            has_col = c.execute("""SELECT 1 AS x FROM information_schema.columns
                                   WHERE table_name='hotspot' AND column_name='geom'""").fetchone() is not None
            self.postgis = has and has_col and not settings.force_no_postgis
            q = c.execute("""SELECT coalesce(percentile_cont(0.75) WITHIN GROUP (ORDER BY risk_score), 0) AS q75,
                                    coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY risk_score), 0) AS q95
                             FROM hotspot""").fetchone()
            self.risk_q75, self.risk_q95 = float(q["q75"]), float(q["q95"])

    def close(self) -> None:
        if self.pool:
            self.pool.close()

    @contextmanager
    def conn(self) -> Iterator[Connection[dict[str, Any]]]:
        assert self.pool is not None, "資料庫尚未連線"
        with self.pool.connection() as c:
            yield c

    def level(self, risk: float) -> str:
        if risk >= self.risk_q95:
            return "high"
        if risk >= self.risk_q75:
            return "medium"
        return "low"


db = Database()


def haversine_sql(lat_col: str, lon_col: str) -> str:
    """沒有 PostGIS 時的距離（公尺）計算式，參數 %(lat)s、%(lon)s。只用標準數學函式。"""
    return (f"(6371000 * 2 * asin(sqrt(power(sin(radians({lat_col} - %(lat)s) / 2), 2)"
            f" + cos(radians(%(lat)s)) * cos(radians({lat_col}))"
            f" * power(sin(radians({lon_col} - %(lon)s) / 2), 2))))")

"""本專案的唯讀 PostgreSQL MCP server（給 Claude Code / Codex 直接查詢本機資料庫）。

- 用官方 MCP Python SDK（mcp 2.x 的 MCPServer）寫成，stdio 傳輸。
- 連線字串讀環境變數 DATABASE_URI（預設 mcp_readonly@127.0.0.1/traffic，該帳號在資料庫內只有 SELECT 權限）。
- 每次查詢都在 READ ONLY 交易中執行，並限制 15 秒逾時、最多回傳 200 列。

為什麼自己寫：第三方 postgres-mcp 在 2026-10 與 mcp 2.x / pglast 版本不相容，無法安裝（見 docs/decisions.md）。
"""
from __future__ import annotations

import json
import os
from typing import Any

import psycopg
from mcp.server.mcpserver import MCPServer
from psycopg.rows import dict_row

DSN = os.environ.get("DATABASE_URI", "postgresql://mcp_readonly@127.0.0.1:5432/traffic")
MAX_ROWS = 200

server = MCPServer(name="traffic-postgres", instructions=(
    "交通事故專題的 PostgreSQL（唯讀）。主要資料表：accident（事故）、party（當事人）、hotspot（危險路口）、"
    "cause_code、collision_type、user_report、model_version、prediction。先用 list_tables / describe_table 了解結構。"))


def _query(sql: str, params: Any = None) -> list[dict[str, Any]]:
    with psycopg.connect(DSN, row_factory=dict_row, autocommit=False) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute("SET LOCAL statement_timeout = '15s'")
        cur = conn.execute(sql, params)
        rows = cur.fetchmany(MAX_ROWS) if cur.description else []
        conn.rollback()
    return rows


def _dump(rows: list[dict[str, Any]]) -> str:
    return json.dumps(rows, ensure_ascii=False, default=str, indent=1)


@server.tool(description="列出 public schema 的資料表與估計筆數")
def list_tables() -> str:
    return _dump(_query("""SELECT c.relname AS table, c.reltuples::bigint AS estimated_rows,
                                  obj_description(c.oid) AS comment
                           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname"""))


@server.tool(description="查看資料表欄位（名稱、型別、可否為空）與外鍵")
def describe_table(table: str) -> str:
    cols = _query("""SELECT column_name, data_type, is_nullable FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position""", (table,))
    fks = _query("""SELECT kcu.column_name, ccu.table_name AS references_table
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = %s""", (table,))
    return _dump([{"columns": cols, "foreign_keys": fks}])


@server.tool(description=f"執行唯讀 SQL（SELECT / WITH / EXPLAIN），最多回傳 {MAX_ROWS} 列")
def execute_sql(sql: str) -> str:
    try:
        return _dump(_query(sql))
    except psycopg.Error as e:
        return f"SQL 錯誤：{e}"


if __name__ == "__main__":
    server.run()

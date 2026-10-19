@AGENTS.md

## Claude Code 專屬補充
- 專案規則一律改 AGENTS.md，本檔只放 Claude 專屬事項。
- 交叉審查：`/codex:review --background`，之後 `/codex:status`、`/codex:result`；需要挑戰設計時用 `/codex:adversarial-review`。
- 委派獨立任務給 Codex：`/codex:rescue --background <任務說明>`。
- 本專案 MCP 設定在 `.mcp.json`（context7、playwright、postgres），清單與用途見 README。
- Windows 環境：shell 是 PowerShell 5.1；新裝的工具若找不到，先重新載入 PATH：
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

# Claude Code ⇄ Codex 接力說明

兩邊共用：`AGENTS.md`（規則）、`HANDOFF.md`（進度交接）、`TASKS.md`（任務與負責方）。開工前一定先讀這三個檔，並看 `git status`、`git log`。

## A. Claude 額度用完 → 改用 Codex 接手

1. 打開 Codex（桌面版或終端機 `codex`），工作資料夾選 `E:\User\桌面\資料庫專題`，信任此資料夾（才會載入 `.codex/config.toml` 的 MCP）。
2. 貼上這段接手指令：

```
你要接手這個專案（Claude Code 額度用完）。請依序：
1. 讀 AGENTS.md（專案規則，必須遵守）、HANDOFF.md、TASKS.md。
2. 執行 git status 與 git log --oneline -15，確認目前狀態與 HANDOFF.md 一致；有未 commit 的變更先檢查是誰留下的、是否完整。
3. 開新分支 codex/<主題>（若 HANDOFF.md 說在 main 上直接做也可以）。
4. 從 HANDOFF.md 的「下一步」開始做；在 TASKS.md 把該任務標成「進行中（Codex）」。
5. 每完成一個小任務：跑測試（uv run pytest；前端改動要 cd frontend && npx vite build），中文 commit，更新 HANDOFF.md 並 commit。
6. 需要使用者做的事（登入、手機操作、管理員權限、付費）寫進 HANDOFF.md 最上方「待我處理」，然後繼續做其他工作。
```

## B. Codex 額度用完 → 回到 Claude Code 接手

在 Claude Code（桌面版 Code 分頁或終端機 `claude`，資料夾同上）貼上：

```
你要從 Codex 接手這個專案。請依序：
1. 讀 HANDOFF.md、TASKS.md（AGENTS.md 已由 CLAUDE.md 自動載入）。
2. git status、git log --oneline -15、git branch -a：找出 Codex 的分支（codex/...）與最後的 commit。
3. 檢查 Codex 最後的改動：跑 uv run pytest、cd frontend && npx vite build；有問題先修。
4. 測試通過後把 codex/... 分支合併回 main（使用者同意的話），更新 HANDOFF.md。
5. 從 HANDOFF.md 的「下一步」繼續。
```

## C. 平常協作（兩邊都有額度時）

| 情境 | 指令（在 Claude Code） |
|---|---|
| 讓 Codex 審查目前改動 | `/codex:review --background`，之後 `/codex:status`、`/codex:result` |
| 對設計提出質疑式審查 | `/codex:adversarial-review <要挑戰的重點>` |
| 把獨立任務交給 Codex | `/codex:rescue --background <任務說明>` |
| 檢查 Codex 是否就緒 | `/codex:setup` |

規則：兩邊同時工作時用不同分支（`claude/...`、`codex/...`），不要同時改同一個檔案。

## D. 查看各自的額度

| 工具 | 方法 |
|---|---|
| Claude Code | 終端機版輸入 `/usage`（或 `/status`）；桌面版看設定中的「用量」；網頁 claude.ai → Settings → Usage |
| Codex | 終端機版 `codex` 中輸入 `/status`（顯示 5 小時與每週額度使用率）；或 ChatGPT 網頁 → 設定 → Codex 用量（https://chatgpt.com/codex/settings/usage） |

快到上限時：先更新 HANDOFF.md 並 commit，再換另一邊。

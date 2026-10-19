# 端對端測試：確認伺服器在執行 → 跑 Playwright → 清除測試產生的回報
# 用法：powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$env:PYTHONIOENCODING = 'utf-8'
Push-Location $Root
try {
    try { $h = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 5 } catch { $h = $null }
    if (-not $h -or $h.status -ne 'ok') {
        Write-Host '伺服器沒有在執行，先啟動…' -ForegroundColor Yellow
        uv run python scripts/server.py start
    }
    Push-Location frontend
    npx vite build | Out-Null
    npx playwright test @args
    $code = $LASTEXITCODE
    Pop-Location
    uv run python scripts/cleanup_e2e.py
    exit $code
} finally { Pop-Location }

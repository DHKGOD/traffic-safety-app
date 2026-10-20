# 從「最新 commit」打包 APK（不含工作目錄裡還沒 commit 的修改），並（若有接手機）安裝。
# 用途：工作目錄有使用者還沒決定的修改（例如 App 內更新）時，避免被包進 APK。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build_apk_clean.ps1 [-NoInstall] [-Ref <commit>]
param([switch]$NoInstall, [string]$Ref = 'HEAD')
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
# 英文路徑（Gradle 在中文路徑下有問題），每次重用同一個 worktree 以保留 node_modules 與 Gradle 快取
$Wt = Join-Path $env:TEMP 'youluan-apkbuild'
$commit = (git -C $Root rev-parse $Ref).Trim()

if (-not (Test-Path (Join-Path $Wt '.git'))) {
    git -C $Root worktree prune
    git -C $Root worktree add --detach $Wt $commit -q
    if ($LASTEXITCODE) { throw '建立 worktree 失敗' }
} else {
    git -C $Wt checkout -q --detach $commit
    if ($LASTEXITCODE) { throw '切換 worktree 版本失敗' }
}
Write-Host "== 打包 commit $(git -C $Wt log --oneline -1) ==" -ForegroundColor Cyan

# Android SDK 位置檔（不進 Git）
$lp = Join-Path $Root 'frontend\android\local.properties'
if (Test-Path $lp) { Copy-Item $lp (Join-Path $Wt 'frontend\android\') -Force }

Push-Location (Join-Path $Wt 'frontend')
try {
    if (-not (Test-Path 'node_modules') -or ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime)) {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'npm ci 失敗' }
    }
} finally { Pop-Location }

& powershell -ExecutionPolicy Bypass -File (Join-Path $Wt 'scripts\build_apk.ps1') -NoInstall
if ($LASTEXITCODE) { throw '打包失敗' }

$apk = Join-Path $Wt 'dist\traffic-safety-debug.apk'
$out = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $apk (Join-Path $out 'traffic-safety-debug.apk') -Force
Write-Host "APK：$out\traffic-safety-debug.apk" -ForegroundColor Green

if (-not $NoInstall) {
    $dev = (adb devices) -match "`tdevice$"
    if ($dev) {
        adb install -r $apk
        adb shell monkey -p tw.edu.fju.trafficsafety -c android.intent.category.LAUNCHER 1 | Out-Null
        Write-Host '已安裝並啟動到手機' -ForegroundColor Green
    } else {
        Write-Host '沒有偵測到手機（adb devices），略過安裝' -ForegroundColor Yellow
    }
}

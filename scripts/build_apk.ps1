# 打包 Android debug APK，並（若有接手機）用 adb 安裝、啟動
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build_apk.ps1 [-NoInstall]
param([switch]$NoInstall)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Front = Join-Path $Root 'frontend'

# 工具路徑（JDK 21、Android SDK）
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:USERPROFILE 'Android\Sdk' }
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;" + $env:Path
# 部分防毒軟體會攔截 TLS：讓 Gradle 使用 Windows 憑證庫
$env:GRADLE_OPTS = '-Djavax.net.ssl.trustStoreType=Windows-ROOT'

Push-Location $Front
try {
    Write-Host '== 1/3 建置網頁 ==' -ForegroundColor Cyan
    npx vite build
    if ($LASTEXITCODE) { throw 'vite build 失敗' }
    Write-Host '== 2/3 同步到 Android 專案 ==' -ForegroundColor Cyan
    npx cap sync android
    if ($LASTEXITCODE) { throw 'cap sync 失敗' }
    Write-Host '== 3/3 Gradle 打包 ==' -ForegroundColor Cyan
    Push-Location android
    .\gradlew.bat assembleDebug -q
    $code = $LASTEXITCODE
    Pop-Location
    if ($code) { throw 'Gradle 打包失敗' }
} finally { Pop-Location }

$apk = Join-Path $Front 'android\app\build\outputs\apk\debug\app-debug.apk'
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

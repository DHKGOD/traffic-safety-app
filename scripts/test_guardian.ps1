# 守護模式判斷邏輯（GuardianEngine，純 Java）的單元測試
# Gradle 的測試程式在「含中文的專案路徑」下載入不到類別，所以把原始碼複製到英文暫存路徑，直接用 javac＋JUnit 執行。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\test_guardian.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Src = Join-Path $Root 'frontend\android\app\src'
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
$cache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
$junit = Get-ChildItem "$cache\junit\junit\4.13.2" -Recurse -Filter 'junit-4.13.2.jar' | Select-Object -First 1
$ham = Get-ChildItem "$cache\org.hamcrest\hamcrest-core\1.3" -Recurse -Filter 'hamcrest-core-1.3.jar' | Select-Object -First 1
if (-not $junit -or -not $ham) { throw '找不到 JUnit（請先跑一次 gradlew assembleDebug 讓 Gradle 下載）' }

$work = Join-Path $env:TEMP ('guardian-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force "$work\src", "$work\out" | Out-Null
try {
    Copy-Item "$Src\main\java\tw\edu\fju\trafficsafety\guardian\GuardianEngine.java" "$work\src\"
    Copy-Item "$Src\test\java\tw\edu\fju\trafficsafety\guardian\GuardianEngineTest.java" "$work\src\"
    $cp = "$($junit.FullName);$($ham.FullName)"
    & "$env:JAVA_HOME\bin\javac.exe" -encoding UTF-8 -d "$work\out" -cp $cp "$work\src\GuardianEngine.java" "$work\src\GuardianEngineTest.java"
    if ($LASTEXITCODE) { throw '編譯失敗' }
    & "$env:JAVA_HOME\bin\java.exe" -cp "$work\out;$cp" org.junit.runner.JUnitCore tw.edu.fju.trafficsafety.guardian.GuardianEngineTest
    exit $LASTEXITCODE
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

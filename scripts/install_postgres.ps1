# 在 Windows 安裝免安裝版 PostgreSQL 18 + PostGIS 3.6（不需系統管理員權限、不建立 Windows 服務）
# 安裝位置：%LOCALAPPDATA%\Programs\pgsql18
# 來源：EnterpriseDB 官方 binaries zip、OSGeo 官方 PostGIS bundle
# 用法（PowerShell）：powershell -ExecutionPolicy Bypass -File scripts\install_postgres.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PgVersion = '18.6-1'
$PostgisZip = 'postgis-bundle-pg18-3.6.2x64.zip'
$Dest = Join-Path $env:LOCALAPPDATA 'Programs\pgsql18'
if (Test-Path (Join-Path $Dest 'bin\postgres.exe')) { Write-Host "已安裝：$Dest"; exit 0 }

$tmp = Join-Path $env:TEMP ('pg-install-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp | Out-Null
Write-Host '下載 PostgreSQL...'
Invoke-WebRequest "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip" -OutFile "$tmp\pg.zip"
Write-Host '下載 PostGIS...'
Invoke-WebRequest "https://download.osgeo.org/postgis/windows/pg18/$PostgisZip" -OutFile "$tmp\postgis.zip"
Expand-Archive "$tmp\pg.zip" -DestinationPath $tmp -Force
Expand-Archive "$tmp\postgis.zip" -DestinationPath "$tmp\postgis" -Force
New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null
Move-Item "$tmp\pgsql" $Dest
$bundle = Get-ChildItem "$tmp\postgis" -Directory | Select-Object -First 1
foreach ($d in 'bin', 'lib', 'share', 'gdal-data', 'utils') {
    if (Test-Path "$($bundle.FullName)\$d") { Copy-Item "$($bundle.FullName)\$d" $Dest -Recurse -Force }
}
Remove-Item $tmp -Recurse -Force
& "$Dest\bin\postgres.exe" --version
Write-Host "完成：$Dest"

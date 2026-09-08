# start-now.ps1 —— 立即前台启动前后端 + cpolar（调试用，不做自启）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\start-now.ps1
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host '=== 启动后端 (node src/index.js, :3000) ==='
Start-Process -FilePath node -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $repoRoot 'server') -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host '=== 启动 cpolar 隧道 (community → http://localhost:3000) ==='
$cpolarExe = "$env:USERPROFILE\cpolar\cpolar.exe"
if (Test-Path $cpolarExe) {
  $cfg = Join-Path $env:USERPROFILE '.cpolar\cpolar.yml'
  Start-Process -FilePath $cpolarExe -ArgumentList "start community --config `"$cfg`"" -WorkingDirectory (Split-Path $cpolarExe) -WindowStyle Minimized
} else {
  Write-Warning '未找到 cpolar.exe，请先安装'
}
Write-Host ''
Write-Host '本机测试:   http://localhost:3000'
Write-Host 'cpolar 日志: 运行 cpolar status 查看公网地址'

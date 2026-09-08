# ============================================================
# install-services.ps1 —— 将社团招新系统注册为 Windows 开机自启服务
#
# 用法（在 PowerShell 中以管理员身份运行，或接受 UAC 提示）：
#   powershell -ExecutionPolicy Bypass -File scripts\install-services.ps1
#
# 注册两个计划任务：
#   1) Community-Server —— 启动后端 node 服务（:3000）
#   2) Community-Cpolar —— 启动 cpolar 隧道（公网映射）
# 以"当前用户登录时"触发（无需管理员，走用户级任务计划）
# ============================================================

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot 'server'
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  # node 可能不在 PATH，尝试常见安装位置
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  $nodeExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $nodeExe) { throw '未找到 node.exe，请先安装 Node.js 并加入 PATH' }
Write-Host "[1/3] node: $nodeExe"

# cpolar 可执行文件（免安装版位置；若是系统安装，脚本会再探测）
$cpolarExe = "$env:USERPROFILE\cpolar\cpolar.exe"
if (-not (Test-Path $cpolarExe)) {
  $installed = Get-ChildItem "$env:ProgramFiles","${env:ProgramFiles(x86)}" -Filter cpolar.exe -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($installed) { $cpolarExe = $installed.FullName }
}
if (-not (Test-Path $cpolarExe)) { Write-Warning '未找到 cpolar.exe，跳过隧道任务（稍后手动安装 cpolar 后重跑本脚本）' }
else { Write-Host "[2/3] cpolar: $cpolarExe" }

# ---- 任务 1：后端服务（隐藏窗口运行，随用户登录自启）----
$serverTask = Get-ScheduledTask -TaskName 'Community-Server' -ErrorAction SilentlyContinue
$serverAction = New-ScheduledTaskAction -Execute $nodeExe -Argument "src/index.js" -WorkingDirectory $serverDir
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$serverSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName 'Community-Server' -Action $serverAction -Trigger $serverTrigger -Settings $serverSettings -Description '社团招新系统后端 (node :3000)' -Force | Out-Null
Write-Host '[3/3] 已注册任务 Community-Server（登录自启，node 后端）'

# ---- 任务 2：cpolar 隧道（可选）----
if (Test-Path $cpolarExe) {
  $cpolarConfig = Join-Path $env:USERPROFILE '.cpolar\cpolar.yml'
  $cpolarAction = New-ScheduledTaskAction -Execute $cpolarExe -Argument "start community --config `"$cpolarConfig`"" -WorkingDirectory (Split-Path $cpolarExe)
  $cpolarTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $cpolarSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  Register-ScheduledTask -TaskName 'Community-Cpolar' -Action $cpolarAction -Trigger $cpolarTrigger -Settings $cpolarSettings -Description 'cpolar 内网穿透隧道(community → :3000)' -Force | Out-Null
  Write-Host '已注册任务 Community-Cpolar（登录自启，cpolar 隧道）'
}

Write-Host ''
Write-Host '完成。立即手动启动测试：'
Write-Host "  schtasks /run /tn Community-Server"
if (Test-Path $cpolarExe) { Write-Host "  schtasks /run /tn Community-Cpolar" }
Write-Host '查看状态：'
Write-Host "  schtasks /query /tn Community-Server"
Write-Host '删除自启：'
Write-Host "  schtasks /delete /tn Community-Server /f   （Community-Cpolar 同理）"

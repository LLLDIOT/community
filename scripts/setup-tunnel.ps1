<#
.SYNOPSIS
  用 cpolar 把「学生端」和「社团端」发布到公网（内网穿透，零成本方案）。

.DESCRIPTION
  两个站点的公开策略**故意不同**：
    学生端 (3001)  刻意公开：学生必须能自助投递，所以不需要密码。
                   作为补偿，它只有 5 个白名单接口，且不暴露简历附件目录。
    社团端 (3000)  管理台：**必须要有密码**。本脚本会检查 BASIC_AUTH_DISABLE，
                   没开密码就拒绝继续 —— 否则等于把整个管理台裸奔到公网。

  会自动完成：
    1. 安全检查（社团端必须已设访问密码）
    2. 写入 ~/.cpolar/cpolar.yml（两条隧道）
    3. 写入 cpolar 启动脚本（分离进程启动，否则计划任务一结束隧道就被回收）
    4. 注册 Windows 计划任务 Community-Cpolar（登录自启）
    5. 启动并打印两个公网地址

.PARAMETER AppDir
  项目目录，默认取脚本上一级目录。

.PARAMETER SkipAuthCheck
  跳过"社团端必须设密码"的检查。**不建议使用**，仅供本地隔离环境测试。
#>
[CmdletBinding()]
param(
  [string]$AppDir = '',
  [switch]$SkipAuthCheck
)

$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Cyan') { Write-Host $m -ForegroundColor $c }
function Ok($m)   { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "  [警告] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [错误] $m" -ForegroundColor Red; exit 1 }

# $PSScriptRoot 在 param() 默认值里可能还没赋值（PowerShell 5.1 的坑），
# 所以放到脚本体里解析，并兼容几种定位方式。
if (-not $AppDir) {
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
  if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Definition }
  if ($scriptPath) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $scriptPath)
  } else {
    $AppDir = (Get-Location).Path
  }
}
if (-not $AppDir -or -not (Test-Path $AppDir)) { Die "无法确定项目目录，请用 -AppDir 指定" }

Say ""
Say "=== 社团招新系统 · cpolar 双站点发布 ==="
Say ""

# ── 0. 定位 cpolar ──
$cpolarExe = Join-Path $env:USERPROFILE 'cpolar\cpolar.exe'
if (-not (Test-Path $cpolarExe)) {
  $cmd = Get-Command cpolar -ErrorAction SilentlyContinue
  if ($cmd) { $cpolarExe = $cmd.Source } else { Die "找不到 cpolar.exe，请先安装 cpolar" }
}
$cpolarDir  = Split-Path -Parent $cpolarExe
$cpolarHome = Join-Path $env:USERPROFILE '.cpolar'
New-Item -ItemType Directory -Force -Path $cpolarHome | Out-Null
Ok "cpolar: $cpolarExe"

# ── 1. 安全检查 ──
Say ""
Say "[1/5] 安全检查：社团端是否有访问密码"
$envFile = Join-Path $AppDir 'server\.env'
if (-not (Test-Path $envFile)) { Die "找不到 $envFile" }

$envText  = Get-Content $envFile -Raw -Encoding UTF8
$disabled = $envText -match '(?m)^\s*BASIC_AUTH_DISABLE\s*=\s*1'
$hasPass  = $envText -match '(?m)^\s*BASIC_AUTH_PASS\s*=\s*\S+'

if ($disabled -or -not $hasPass) {
  if ($SkipAuthCheck) {
    Warn "社团端当前【没有密码】，但你指定了 -SkipAuthCheck，继续执行"
  } else {
    Say ""
    Say "社团端当前没有访问密码。" 'Red'
    Say "把没有密码的管理台发布到公网 = 任何人都能改社团数据、看学生简历。" 'Red'
    Say ""
    Say "请先设置密码，然后重新运行本脚本。手动改这里："
    Say "    $envFile"
    Say "      BASIC_AUTH_USER=admin"
    Say "      BASIC_AUTH_PASS=<一个强密码>"
    Say "      BASIC_AUTH_DISABLE=0"
    Say ""
    Say "改完重启服务：  Start-ScheduledTask -TaskName 'Community-Server'"
    Say ""
    exit 1
  }
} else {
  Ok "社团端已启用访问密码"
}

# ── 2. 写隧道配置 ──
Say ""
Say "[2/5] 写入 cpolar 隧道配置"
$cfgPath = Join-Path $cpolarHome 'cpolar.yml'

$authtoken = ''
if (Test-Path $cfgPath) {
  $bak = "$cfgPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $cfgPath $bak -Force
  Ok "原配置已备份：$(Split-Path -Leaf $bak)"
  $m = [regex]::Match((Get-Content $cfgPath -Raw -Encoding UTF8), '(?m)^\s*authtoken\s*:\s*(\S+)')
  if ($m.Success) { $authtoken = $m.Groups[1].Value }
}
if (-not $authtoken) {
  Warn "配置里没有 authtoken"
  Die "请先执行： & '$cpolarExe' authtoken <你的token>  （到 https://dashboard.cpolar.com/auth 获取）"
}
Ok "已保留原 authtoken"

$yml = "authtoken: $authtoken`ntunnels:`n  student:`n    proto: http`n    addr: `"3001`"`n  community:`n    proto: http`n    addr: `"3000`"`n"
[System.IO.File]::WriteAllText($cfgPath, $yml, (New-Object System.Text.UTF8Encoding $false))
Ok "已写入两条隧道：student->3001，community->3000"

# ── 3. 写启动脚本（用单引号 here-string，避免 $env: 被外层展开）──
Say ""
Say "[3/5] 写入启动脚本（分离进程启动）"
$startScript = Join-Path $cpolarDir 'start-with-proxy.ps1'

$template = @'
# cpolar 启动脚本（由计划任务 Community-Cpolar 在登录时调用）
#
# 为什么用 Start-Process 分离启动：
#   计划任务若在前台运行 cpolar，任务一结束子进程会被一起回收，
#   表现为"任务显示成功、但隧道根本没起来"。
#
# 本机出网需要走代理（Clash :7897），所以先设好代理环境变量。
#
# 两个站点：
#   student   -> 3001  学生端：刻意公开、无需密码、5 个白名单接口
#   community -> 3000  社团端管理台：必须有密码
$env:ALL_PROXY   = 'socks5://127.0.0.1:7897'
$env:all_proxy   = 'socks5://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY  = 'http://127.0.0.1:7897'

Get-Process cpolar -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Start-Process -FilePath '__CPOLAR_EXE__' `
  -ArgumentList 'start-all', '--log', '__CPOLAR_LOG__', '--log-level', 'INFO' `
  -WorkingDirectory '__CPOLAR_DIR__' `
  -WindowStyle Hidden
'@

$ps1 = $template.Replace('__CPOLAR_EXE__', $cpolarExe).
                   Replace('__CPOLAR_LOG__', (Join-Path $cpolarHome 'run.log')).
                   Replace('__CPOLAR_DIR__', $cpolarDir)
[System.IO.File]::WriteAllText($startScript, $ps1, (New-Object System.Text.UTF8Encoding $false))
Ok "已写入 $startScript"

# ── 4. 注册计划任务 ──
Say ""
Say "[4/5] 配置开机自启"
$taskName = 'Community-Cpolar'
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"'

# 优先用「启动文件夹」：不需要管理员权限，最可靠。
# 计划任务里 -AtLogOn 的注册需要提权（Register-ScheduledTask 会报 Access is denied），
# 所以这里只在"已经存在同名任务"时顺手清理掉，避免重复启动。
$startupDir = [Environment]::GetFolderPath('Startup')
$startupCmd = Join-Path $startupDir 'community-cpolar.cmd'
$cmdBody = "@echo off`r`n" +
           "rem 社团招新系统 cpolar 双隧道自启（学生端 3001 + 社团端 3000）`r`n" +
           "rem 由 scripts/setup-tunnel.ps1 生成；不需要管理员权限`r`n" +
           "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"`r`n"
[System.IO.File]::WriteAllText($startupCmd, $cmdBody, [System.Text.Encoding]::ASCII)
Ok "已写入启动项：$startupCmd"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Ok "已清理同名计划任务（避免重复启动）"
  } catch {
    Warn "存在同名计划任务但无权限删除，可能重复启动；可手动在任务计划程序里删掉 $taskName"
  }
}

# ── 5. 启动并打印地址 ──
Say ""
Say "[5/5] 启动隧道"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript
Say "  等待隧道建立（约 30 秒）…"
Start-Sleep -Seconds 30

$log = Join-Path $cpolarHome ('run.log.' + (Get-Date -Format 'yyyyMMdd'))
$urls = @()
if (Test-Path $log) {
  $urls = [regex]::Matches((Get-Content $log -Raw -Encoding UTF8), 'established at (http://[a-z0-9.]+)') |
            ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
}

$stuUrl = $null; $clubUrl = $null
foreach ($u in $urls) {
  try {
    $h = (Invoke-WebRequest "$u/healthz" -UseBasicParsing -TimeoutSec 10).Content
    if ($h -match 'student') { $stuUrl = $u } elseif ($h -match 'club') { $clubUrl = $u }
  } catch { }
}

Say ""
Say "════════════════════════════════════════════"
if ($stuUrl) {
  Say "  [学生端] 发给学生，无需密码" 'Green'
  Say "     $stuUrl"
} else {
  Warn "学生端地址未识别，查看日志：$log"
}
if ($clubUrl) {
  Say ""
  Say "  [社团端] 你自己用，需要密码" 'Green'
  Say "     $clubUrl"
  $pwLine = (Select-String -Path $envFile -Pattern '^\s*BASIC_AUTH_PASS\s*=' -Encoding UTF8 | Select-Object -First 1).Line
  if ($pwLine) { Say "     用户名 admin / 密码 $(($pwLine -split '=', 2)[1].Trim())" }
} else {
  Warn "社团端地址未识别，查看日志：$log"
}
Say ""
Say "  提醒："
Say "    · 免费版域名在隧道重启后会变，要固定需购买保留域名"
Say "    · 依赖本机常开 + 代理（Clash :7897）常开"
Say "    · 社团端必须有密码，本脚本已强制检查"
Say "════════════════════════════════════════════"

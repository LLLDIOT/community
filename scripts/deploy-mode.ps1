<#
.SYNOPSIS
    切换部署模式：本机 / 公网

.DESCRIPTION
    本机模式（local）
      - 停止 cpolar 内网穿透进程
      - 把启动项 community-cpolar.cmd 改名为 .disabled，取消开机自动拉起隧道
      - 服务本身不受影响，仍由计划任务 Community-Server 在登录时启动（端口 3000 / 3001）

    公网模式（public）
      - 恢复启动项
      - 调用 scripts/setup-tunnel.ps1 重建隧道并打印新的公网地址

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-mode.ps1 -Mode local
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-mode.ps1 -Mode public
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('local', 'public', 'status')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

$startupDir = [Environment]::GetFolderPath('Startup')
$enabledCmd = Join-Path $startupDir 'community-cpolar.cmd'
$disabledCmd = Join-Path $startupDir 'community-cpolar.cmd.disabled'
$appRoot = Split-Path -Parent $PSScriptRoot

function Show-Status {
    Write-Host ''
    Write-Host '当前状态' -ForegroundColor Cyan
    Write-Host ('  服务    :3000 ' + $(try { (Invoke-WebRequest 'http://localhost:3000/healthz' -UseBasicParsing -TimeoutSec 4).StatusCode } catch { '不可用' }))
    Write-Host ('  学生端  :3001 ' + $(try { (Invoke-WebRequest 'http://localhost:3001/healthz' -UseBasicParsing -TimeoutSec 4).StatusCode } catch { '不可用' }))

    $proc = Get-Process cpolar -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host ('  隧道    : 运行中（pid ' + ($proc.Id -join ',') + '）') -ForegroundColor Yellow
    }
    else {
        Write-Host '  隧道    : 未运行' -ForegroundColor Green
    }

    if (Test-Path $enabledCmd) {
        Write-Host '  自启项  : 已启用（登录时会拉起隧道）' -ForegroundColor Yellow
    }
    elseif (Test-Path $disabledCmd) {
        Write-Host '  自启项  : 已禁用' -ForegroundColor Green
    }
    else {
        Write-Host '  自启项  : 不存在'
    }
    Write-Host ''
}

switch ($Mode) {

    'local' {
        Write-Host ''
        Write-Host '切换到【本机部署】' -ForegroundColor Cyan

        $proc = Get-Process cpolar -ErrorAction SilentlyContinue
        if ($proc) {
            $proc | Stop-Process -Force
            Start-Sleep -Seconds 2
            Write-Host '  已停止 cpolar 隧道进程' -ForegroundColor Green
        }
        else {
            Write-Host '  隧道进程本来就没在运行'
        }

        if (Test-Path $enabledCmd) {
            Move-Item $enabledCmd $disabledCmd -Force
            Write-Host '  已禁用开机自启（community-cpolar.cmd -> .disabled）' -ForegroundColor Green
        }
        elseif (Test-Path $disabledCmd) {
            Write-Host '  开机自启本来就是禁用状态'
        }
        else {
            Write-Host '  没有找到自启项，跳过'
        }

        Write-Host ''
        Write-Host '  服务仍在本机运行：' -ForegroundColor Cyan
        Write-Host '    社团端  http://localhost:3000'
        Write-Host '    学生端  http://localhost:3001'
        Write-Host ''
        Write-Host '  公网地址已失效（之前分享出去的链接会返回 404）。'
        Write-Host ''
        Show-Status
    }

    'public' {
        Write-Host ''
        Write-Host '切换到【公网部署】' -ForegroundColor Cyan

        if (Test-Path $disabledCmd) {
            Move-Item $disabledCmd $enabledCmd -Force
            Write-Host '  已恢复开机自启' -ForegroundColor Green
        }

        $setup = Join-Path $PSScriptRoot 'setup-tunnel.ps1'
        if (-not (Test-Path $setup)) {
            Write-Host ('  未找到 ' + $setup + '，无法自动重建隧道') -ForegroundColor Red
            exit 1
        }

        Write-Host '  正在重建隧道...' -ForegroundColor Cyan
        & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
        Write-Host ''
        Write-Host '  注意：免费版域名每次重连都会变，请以脚本最后打印的地址为准。' -ForegroundColor Yellow
        Show-Status
    }

    'status' {
        Show-Status
    }
}

# 像素画修复工具 —— 本地静态服务器
# 用法：右键“使用 PowerShell 运行”，或在终端执行：
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1
# 然后打开 http://127.0.0.1:8123/
# 参数：-Port 9000 可改端口；-NoOpen 只启动服务、不自动打开浏览器。

param(
  [int]$Port = 8123,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if ($Port -lt 1 -or $Port -gt 65535) {
  throw "端口无效：$Port"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $python) {
  throw '未找到 Python，请先安装 Python 3，或直接双击 index.html 使用兼容模式。'
}

Write-Host ''
Write-Host '  像素画修复工具 · PIXFIX' -ForegroundColor Cyan
Write-Host "  目录：$root"
Write-Host "  地址：http://127.0.0.1:$Port/"
Write-Host '  按 Ctrl+C 停止服务。'
Write-Host ''

$arguments = @('-m', 'http.server', "$Port", '--bind', '127.0.0.1')
$server = Start-Process -FilePath $python.Source -ArgumentList $arguments -WorkingDirectory $root -NoNewWindow -PassThru

try {
  Start-Sleep -Milliseconds 700
  if (-not $NoOpen) {
    Start-Process "http://127.0.0.1:$Port/"
  }
  Wait-Process -Id $server.Id
}
finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}

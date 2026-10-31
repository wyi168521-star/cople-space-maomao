$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

# 运行构建产物时使用宿主环境注入的变量，避免偷偷加载本地开发地址或覆盖云平台端口。
if (-not $env:PORT) { $env:PORT = '3200' }
if (-not $env:HOST) { $env:HOST = '0.0.0.0' }
node .output/server/index.mjs

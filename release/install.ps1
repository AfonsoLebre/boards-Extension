# Anturio Boards - instalador Claude Code (Windows)
# Corre a partir da pasta extraida do zip:
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $HOME '.anturio-boards'
$SkillDir   = Join-Path $HOME '.claude\skills\anturioboards'
$DefaultUrl = 'https://boards.anturio.app'

Write-Host '== Anturio Boards - instalador Claude Code =='

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "'node' nao encontrado. Instala Node.js 18+ : https://nodejs.org"; exit 1
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Error "'claude' (Claude Code) nao encontrado. Instala: https://claude.com/claude-code"; exit 1
}
if (-not (Test-Path (Join-Path $ScriptDir 'index.js'))) {
  Write-Error 'index.js nao encontrado ao lado deste script. Extrai o zip todo.'; exit 1
}

# API key: env ANTURIO_API_KEY ou pergunta
if ($env:ANTURIO_API_KEY) { $Key = $env:ANTURIO_API_KEY }
else { $Key = Read-Host 'Cola a tua API Key do Anturio Boards (ant_...)' }
if ([string]::IsNullOrWhiteSpace($Key)) { Write-Error 'API Key vazia. Abortado.'; exit 1 }

$ServerUrl = if ($env:ANTURIO_SERVER_URL) { $env:ANTURIO_SERVER_URL } else { $DefaultUrl }

# 1) servidor MCP -> path estavel
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item (Join-Path $ScriptDir 'index.js') (Join-Path $InstallDir 'index.js') -Force

# 2) skill -> ~/.claude/skills
New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null
Copy-Item (Join-Path $ScriptDir 'SKILL.md') (Join-Path $SkillDir 'SKILL.md') -Force

# 3) regista o MCP server (scope user). Forward slashes evitam problemas de escaping.
$ServerPath = ((Join-Path $InstallDir 'index.js') -replace '\\','/')
claude mcp remove anturio-boards --scope user 2>$null
claude mcp add anturio-boards --scope user -e ANTURIO_API_KEY=$Key -e ANTURIO_SERVER_URL=$ServerUrl -- node $ServerPath

Write-Host ''
Write-Host 'OK. Instalado:'
Write-Host "  servidor : $InstallDir\index.js"
Write-Host "  skill    : $SkillDir\SKILL.md"
Write-Host ''
Write-Host "Reinicia o Claude Code (sessao nova) e experimenta: 'lista os meus projetos'."

@echo off
REM Wrapper robusto para o servidor MCP do Anturio Boards
REM Este script garante que o servidor inicia corretamente com logs detalhados

setlocal

REM Define o diretório do servidor (usa o diretório onde este script está)
cd /d "%~dp0"

REM Verifica se dist/index.js existe
if not exist "dist\index.js" (
    echo [MCP-WRAPPER] ERRO: dist\index.js nao encontrado >&2
    echo [MCP-WRAPPER] Execute: npm run build >&2
    exit /b 1
)

REM Verifica se node_modules existe
if not exist "node_modules" (
    echo [MCP-WRAPPER] ERRO: node_modules nao encontrado >&2
    echo [MCP-WRAPPER] Execute: npm install >&2
    exit /b 1
)

REM Verifica se a API key está definida (a variável pode vir do env do mcpServers)
if "%ANTURIO_API_KEY%"=="" (
    echo [MCP-WRAPPER] ERRO: ANTURIO_API_KEY nao definida >&2
    exit /b 1
)

REM Define defaults para variáveis opcionais
if "%ANTURIO_SERVER_URL%"=="" set ANTURIO_SERVER_URL=https://boards.anturio.app
if "%TRANSPORT%"=="" set TRANSPORT=stdio

REM Log de inicialização
echo [MCP-WRAPPER] Iniciando servidor MCP... >&2
echo [MCP-WRAPPER] API Key: %ANTURIO_API_KEY:~0,10%... >&2
echo [MCP-WRAPPER] Server URL: %ANTURIO_SERVER_URL% >&2
echo [MCP-WRAPPER] Transport: %TRANSPORT% >&2

REM Executa o servidor
node dist\index.js

REM Captura o exit code
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo [MCP-WRAPPER] Servidor terminou com erro: %EXIT_CODE% >&2
)

exit /b %EXIT_CODE%

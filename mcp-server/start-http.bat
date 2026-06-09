@echo off
cd /d "%~dp0"
set TRANSPORT=http
set MCP_PORT=3100
npx tsx src/index.ts

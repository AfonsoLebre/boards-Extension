#!/usr/bin/env sh
# Anturio Boards - instalador Claude Code (macOS / Linux)
# Corre a partir da pasta extraida do zip:  sh install.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.anturio-boards"
SKILL_DIR="$HOME/.claude/skills/anturioboards"
DEFAULT_URL="https://boards.anturio.app"

echo "== Anturio Boards - instalador Claude Code =="

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: 'node' nao encontrado. Instala Node.js 18+ : https://nodejs.org" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERRO: 'claude' (Claude Code) nao encontrado no PATH." >&2
  echo "Instala o Claude Code primeiro: https://claude.com/claude-code" >&2
  exit 1
fi
if [ ! -f "$SCRIPT_DIR/index.js" ]; then
  echo "ERRO: index.js nao encontrado ao lado deste script. Extrai o zip todo." >&2
  exit 1
fi

# API key: env ANTURIO_API_KEY ou pergunta
if [ -n "$ANTURIO_API_KEY" ]; then
  KEY="$ANTURIO_API_KEY"
else
  printf "Cola a tua API Key do Anturio Boards (ant_...): "
  read -r KEY
fi
if [ -z "$KEY" ]; then
  echo "ERRO: API Key vazia. Abortado." >&2
  exit 1
fi

SERVER_URL="${ANTURIO_SERVER_URL:-$DEFAULT_URL}"

# 1) servidor MCP -> path estavel
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/index.js" "$INSTALL_DIR/index.js"

# 2) skill -> ~/.claude/skills
mkdir -p "$SKILL_DIR"
cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"

# 3) regista o MCP server (scope user = todos os projetos). Remove anterior se existir.
claude mcp remove anturio-boards --scope user >/dev/null 2>&1 || true
claude mcp add anturio-boards --scope user \
  -e ANTURIO_API_KEY="$KEY" \
  -e ANTURIO_SERVER_URL="$SERVER_URL" \
  -- node "$INSTALL_DIR/index.js"

echo ""
echo "OK. Instalado:"
echo "  servidor : $INSTALL_DIR/index.js"
echo "  skill    : $SKILL_DIR/SKILL.md"
echo ""
echo "Reinicia o Claude Code (sessao nova) e experimenta: 'lista os meus projetos'."

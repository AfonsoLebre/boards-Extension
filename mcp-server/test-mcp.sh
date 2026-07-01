#!/bin/bash
# Script de teste do servidor MCP do Anturio Boards
# Execute isto para verificar se o servidor está funcional

cd "$(dirname "$0")"

echo "=== Teste do Servidor MCP Anturio Boards ==="
echo ""

# Verifica se o dist/index.js existe
if [ ! -f "dist/index.js" ]; then
  echo "❌ ERRO: dist/index.js não existe"
  echo "   Execute: npm run build"
  exit 1
fi
echo "✓ dist/index.js existe"

# Verifica se node_modules existe
if [ ! -d "node_modules" ]; then
  echo "❌ ERRO: node_modules não existe"
  echo "   Execute: npm install"
  exit 1
fi
echo "✓ node_modules existe"

# Verifica se as variáveis de ambiente estão definidas
if [ -z "$ANTURIO_API_KEY" ]; then
  echo "⚠️  AVISO: ANTURIO_API_KEY não está definida no ambiente"
  echo "   O servidor vai usar a do settings.json"
fi

if [ -z "$ANTURIO_SERVER_URL" ]; then
  echo "⚠️  AVISO: ANTURIO_SERVER_URL não está definida no ambiente"
  echo "   O servidor vai usar https://boards.anturio.app (default)"
fi

echo ""
echo "=== A testar inicialização do servidor... ==="
echo ""

# Testa o servidor com um pedido tools/list
# Usa as variáveis de ambiente do settings.json se não estiverem definidas
export ANTURIO_API_KEY="${ANTURIO_API_KEY:-ant_0a25f35f34161e7c433bd64891d291d20c056d674d55a0f7afb6f711378cd366}"
export ANTURIO_SERVER_URL="${ANTURIO_SERVER_URL:-https://boards.anturio.app}"
export TRANSPORT="stdio"

# Executa o servidor e envia um pedido tools/list
output=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js 2>&1)

# Verifica se há mensagens de erro no stderr
if echo "$output" | grep -q "\[MCP\] ERRO"; then
  echo "❌ ERRO na inicialização:"
  echo "$output" | grep "\[MCP\]"
  exit 1
fi

# Verifica se o servidor respondeu com a lista de ferramentas
if echo "$output" | grep -q '"list_projects"'; then
  echo "✓ Servidor respondeu corretamente"
  echo ""
  echo "=== Logs de inicialização: ==="
  echo "$output" | grep "\[MCP\]"
  echo ""
  echo "=== Ferramentas disponíveis: ==="
  echo "$output" | jq -r '.result.tools[].name' 2>/dev/null || echo "$output" | grep -o '"name":"[^"]*"' | cut -d'"' -f4
  echo ""
  echo "✅ Servidor MCP está funcional!"
  exit 0
else
  echo "❌ Servidor não respondeu corretamente"
  echo ""
  echo "Output completo:"
  echo "$output"
  exit 1
fi

# Anturio Boards MCP Server

Servidor MCP (Model Context Protocol) para integração do Anturio Boards com Claude Code e outras ferramentas AI.

## Instalação Rápida

1. **Instalar dependências:**
   ```bash
   npm install
   ```

2. **Compilar o servidor:**
   ```bash
   npm run build
   ```

3. **Configurar no Claude Code:**
   
   Adicionar ao `~/.claude/settings.json`:
   ```json
   {
     "mcpServers": {
       "anturio-boards": {
         "command": "C:/Users/Duarte Tavares/Documents/Anturio/boards-Extension/mcp-server/start-mcp.bat",
         "env": {
           "ANTURIO_API_KEY": "sua_api_key_aqui",
           "ANTURIO_SERVER_URL": "https://boards.anturio.app",
           "TRANSPORT": "stdio"
         }
       }
     }
   }
   ```

4. **Reiniciar o Claude Code**

## Diagnosticar Problemas

### Teste Manual

Execute o script de teste para verificar se o servidor está funcional:

```bash
cd mcp-server
bash test-mcp.sh
```

Este script vai:
- ✓ Verificar se dist/index.js e node_modules existem
- ✓ Testar a inicialização do servidor
- ✓ Mostrar os logs [MCP] de inicialização
- ✓ Listar todas as ferramentas disponíveis

### Servidor Não Carrega no Claude Code

Se o servidor MCP não carregar (ferramentas não disponíveis), tente:

1. **Ver os logs do Claude Code:**
   - Os logs `[MCP]` e `[MCP-WRAPPER]` aparecem no stderr
   - No terminal: já aparecem automaticamente
   - No desktop app: verificar os logs da aplicação

2. **Verificar a configuração:**
   ```bash
   # Verifica se o caminho está correto
   cat ~/.claude/settings.json | grep -A 10 anturio-boards
   ```

3. **Testar manualmente:**
   ```bash
   cd mcp-server
   bash test-mcp.sh
   ```

4. **Recompilar e reiniciar:**
   ```bash
   cd mcp-server
   npm run build
   # Depois reiniciar o Claude Code completamente
   ```

### Mensagens de Erro Comuns

#### `ERRO: ANTURIO_API_KEY não definida`
- A API key não está configurada no settings.json
- Adicionar `"ANTURIO_API_KEY": "..."` no campo `env` do mcpServers

#### `ERRO: dist/index.js não encontrado`
- O servidor não foi compilado
- Execute: `npm run build`

#### `ERRO: node_modules não encontrado`
- As dependências não foram instaladas
- Execute: `npm install`

#### `Error: No such tool available: mcp__anturio-boards__list_projects`
- O servidor MCP não carregou nesta sessão
- Verificar os logs do Claude Code para mensagens [MCP] ou [MCP-WRAPPER]
- Reiniciar o Claude Code para forçar o recarregamento

## Ferramentas Disponíveis

Quando o servidor carrega corretamente, estas ferramentas ficam disponíveis:

1. **list_projects** - Lista todos os projetos
2. **get_project_cards** - Obtém colunas e cards de um projeto
3. **get_card** - Mostra detalhes completos de um card (checklists, anexos, comentários, etc.)
4. **search_cards** - Pesquisa cards por título ou descrição
5. **create_card** - Cria um novo card
6. **move_card** - Move um card para outra coluna
7. **delete_card** - Apaga um card (requer confirmação)
8. **get_card_comments** - Obtém comentários de um card

## Arquitetura

```
mcp-server/
├── src/
│   ├── index.ts       # Servidor MCP principal (handlers, logging, error handling)
│   └── api.ts         # Cliente API do Anturio Boards
├── dist/              # Código compilado (gerado por npm run build)
├── start-mcp.bat      # Wrapper robusto para Windows
├── test-mcp.sh        # Script de diagnóstico
└── README-MCP.md      # Esta documentação
```

## Desenvolvimento

```bash
# Modo watch (recompila automaticamente)
npm run dev

# Build de produção
npm run build

# Testar o servidor
bash test-mcp.sh
```

## Logs e Debugging

O servidor produz logs detalhados com prefixo `[MCP]`:

```
[MCP] Anturio Boards MCP Server v0.1.0 iniciando...
[MCP] Transport: stdio
[MCP] Server URL: https://boards.anturio.app
[MCP] Servidor stdio conectado e pronto
```

O wrapper adiciona logs com prefixo `[MCP-WRAPPER]`:

```
[MCP-WRAPPER] Iniciando servidor MCP...
[MCP-WRAPPER] API Key: ant_0a25f3...
[MCP-WRAPPER] Server URL: https://boards.anturio.app
[MCP-WRAPPER] Transport: stdio
```

Todos os logs vão para `stderr` para não interferir com o protocolo JSON MCP no `stdout`.

## Troubleshooting Avançado

### O servidor funciona manualmente mas não no Claude Code

Isto indica um problema de lifecycle ou configuração:

1. **Verificar se o caminho no settings.json está correto:**
   - Deve apontar para `start-mcp.bat` (não para `dist/index.js` diretamente)
   - Usar caminhos absolutos ou barras normais (/)

2. **Verificar se as variáveis de ambiente estão corretas:**
   - O campo `env` no mcpServers deve ter ANTURIO_API_KEY
   - ANTURIO_SERVER_URL e TRANSPORT são opcionais (têm defaults)

3. **Verificar se não há múltiplas instâncias:**
   ```bash
   # Windows
   tasklist | findstr node.exe
   ```

4. **Verificar permissões:**
   - O ficheiro start-mcp.bat deve ter permissões de execução
   - O antivírus/Windows Defender pode estar a bloquear

### Performance

O servidor é leve e responde rapidamente:
- Inicialização: ~100-200ms
- Pedidos list_projects: ~300-500ms (depende da API)
- Pedidos get_card: ~200-400ms

Se o servidor demorar mais, pode indicar problemas de rede ou API.

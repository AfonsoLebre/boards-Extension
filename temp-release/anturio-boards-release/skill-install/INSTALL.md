# Tutorial: Instalar Anturio Boards como Skill

Este tutorial mostra como instalar a skill do Anturio Boards no Claude Code e Gemini CLI.

## Pré-requisitos

- Claude Code ou Gemini CLI instalado
- Node.js instalado (para executar o MCP server)
- API Key do Anturio Boards (obtida nas definições da extensão VSCode ou no portal)

---

## Parte 0: Compilar o MCP Server (necessário para as ferramentas funcionarem)

O MCP server é necessário para as ferramentas funcionarem. Se ainda não tens o MCP server compilado:

```bash
cd mcp-server
npm install
npm run build
```

O ficheiro compilado estará em `mcp-server/dist/index.js`.

---

## Parte 1: Configurar o MCP Server no Claude Code

Para configurar o MCP server no Claude Code, edita o ficheiro `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "anturio-boards": {
      "command": "node",
      "args": ["PATH/Para/mcp-server/dist/index.js"],
      "env": {
        "ANTURIO_API_KEY": "a-teu-api-key-aqui"
      }
    }
  }
}
```

Substitui `PATH/Para/` pelo caminho absoluto para a pasta do projeto.

Para obter a API Key, vai às definições da extensão VSCode do Anturio Boards ou ao portal.

---

## Parte 2: Claude Code

### Instalação

1. Cria o diretório da skill:
   ```bash
   mkdir -p ~/.claude/skills/anturioboards
   ```

2. Copia o ficheiro `claude-code/SKILL.md` para `~/.claude/skills/anturioboards/SKILL.md`

3. Reinicia o Claude Code

### Como Usar

Escreve `/anturioboards` no chat para invocar a skill.

---

## Parte 3: Configurar o MCP Server no Gemini CLI

Para configurar o MCP server no Gemini CLI, cria ou edita o ficheiro `~/.gemini/mcp_config.json`:

```json
{
  "servers": {
    "anturio-boards": {
      "command": "node",
      "args": ["PATH/Para/mcp-server/dist/index.js"],
      "env": {
        "ANTURIO_API_KEY": "a-teu-api-key-aqui"
      }
    }
  }
}
```

Substitui `PATH/Para/` pelo caminho absoluto para a pasta do projeto.

Para obter a API Key, vai às definições da extensão VSCode do Anturio Boards ou ao portal.

---

## Parte 4: Gemini CLI

### Instalação

1. Copia a pasta `gemini-cli/` para `~/.gemini/extensions/anturio-boards/`:
   ```bash
   cp -r gemini-cli ~/.gemini/extensions/anturio-boards
   ```

2. Instala a extensão:
   ```bash
   gemini extensions install ~/.gemini/extensions/anturio-boards
   ```

3. Reinicia o Gemini CLI

### Como Usar

Escreve `/anturioboards` no chat para invocar a skill.

---

## Comandos Disponíveis

| Comando | Descrição |
|---------|-----------|
| "Lista projetos" | Lista todos os projetos |
| "Mostra cards do projeto X" | Mostra colunas e cards |
| "Cria um card 'Y'" | Cria um novo card |
| "Move card X para Y" | Move card para outra coluna |
| "Apaga card X" | Apaga um card |

Responde em Português ou no idioma preferido pelo utilizador.
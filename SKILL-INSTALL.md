# Tutorial: Instalar Anturio Boards como Skill

Este tutorial mostra como configurar a extensão Anturio Boards como uma skill, para que possas usar `/anturioboards` no chat e interagir com os teus quadros Kanban.

## Pré-requisitos

1. Ter uma CLI de IA configurada (Claude Code ou Gemini CLI)
2. Ter a API Key do Anturio Boards
3. Ter o MCP server já compilado (veja a secção de compilação se necessário)

---

## Compilar o MCP Server (se necessário)

Se ainda não compilaste o MCP server, executa estes comandos:

```bash
cd C:/Users/Duarte Tavares/Documents/Anturio/boards-Extension/mcp-server
npm install
npm run build
```

O ficheiro compilado estará em `mcp-server/dist/index.js`.

---

## Parte 1: Claude Code

### Configurar o MCP Server

Edita o ficheiro `C:\Users\Duarte Tavares\.claude\settings.json`:

```json
{
  "mcpServers": {
    "anturio-boards": {
      "command": "node",
      "args": ["C:/Users/Duarte Tavares/Documents/Anturio/boards-Extension/mcp-server/dist/index.js"],
      "env": {
        "ANTURIO_API_KEY": "ant_a_sua_api_key_aqui",
        "ANTURIO_SERVER_URL": "https://boards.anturio.app/api"
      }
    }
  }
}
```

**Nota**: Substitua `ant_a_sua_api_key_aqui` pela tua API Key real.

### Instalar a Skill

#### Passo 1: Criar o diretório da skill

```bash
mkdir -p ~/.claude/skills/anturioboards
```

#### Passo 2: Criar o ficheiro SKILL.md

Cria o ficheiro `~/.claude/skills/anturioboards/SKILL.md`:

```yaml
---
description: Interage com o Anturio Boards - gestão de projetos e tarefas. Use quando o utilizador pedir para ver projetos, cards, criar tarefas, mover cards, ou interagir com o quadro Kanban.
---

## Ferramentas Disponíveis

Use as ferramentas MCP disponíveis para interagir com o Anturio Boards:

- `list_projects` - Lista todos os projetos que o utilizador tem acesso
- `get_project_cards` - Obtém todas as colunas e cards de um projeto (necessita project_id ou project_name)
- `create_card` - Cria um novo card (necessita project_id, title, opcionalmente description, column_id, priority, due_date)
- `move_card` - Move um card para outra coluna (necessita card_id, column_id)
- `delete_card` - Apaga um card (necessita card_id e confirm: true)
- `search_cards` - Pesquisa cards por título ou descrição
- `get_card_comments` - Obtém comentários de um card

## Como Usar

- "Lista projetos" / "Mostra os projetos" → Use `list_projects`
- "Mostra cards do projeto [nome]" → Use `get_project_cards` com project_name
- "Cria um card 'Fix bug' no projeto 5" → Use `create_card` com project_id: 5, title: "Fix bug"
- "Move card 123 para coluna 'Done'" → Use `move_card` com card_id: 123, column_id do get_project_cards

Responde em Português ou no idioma preferido pelo utilizador.
```

#### Passo 3: Reiniciar o Claude Code

Reinicie o Claude Code para que a skill seja carregada.

---

## Parte 2: Gemini CLI

### Configurar o MCP Server

#### Passo 1: Editar a configuração global

Edita o ficheiro `C:\Users\Duarte Tavares\AppData\Roaming\gemini\config\mcp_config.json`:

```json
{
  "mcpServers": {
    "anturio-boards": {
      "command": "node",
      "args": ["C:/Users/Duarte Tavares/Documents/Anturio/boards-Extension/mcp-server/dist/index.js"],
      "env": {
        "ANTURIO_API_KEY": "ant_a_sua_api_key_aqui",
        "ANTURIO_SERVER_URL": "https://boards.anturio.app/api"
      }
    }
  }
}
```

**Nota**: Substitua `ant_a_sua_api_key_aqui` pela tua API Key real.

#### Passo 2: Criar a extensão Anturio Boards

Cria uma pasta para a extensão:

```bash
mkdir -p ~/.gemini/extensions/anturio-boards/skills/anturioboards
```

##### Passo 2.1: Criar gemini-extension.json

Cria o ficheiro `~/.gemini/extensions/anturio-boards/gemini-extension.json`:

```json
{
  "name": "anturio-boards",
  "version": "1.0.0",
  "skills": {
    "anturioboards": "./skills/anturioboards"
  }
}
```

##### Passo 2.2: Criar a skill

Cria o ficheiro `~/.gemini/extensions/anturio-boards/skills/anturioboards/SKILL.md`:

```yaml
---
name: anturioboards
description: Interage com o Anturio Boards - gestão de projetos e tarefas. Use quando o utilizador pedir para ver projetos, cards, criar tarefas, mover cards, ou interagir com o quadro Kanban.
---

## Ferramentas Disponíveis

Use as ferramentas MCP disponíveis para interagir com o Anturio Boards:

- `list_projects` - Lista todos os projetos que o utilizador tem acesso
- `get_project_cards` - Obtém todas as colunas e cards de um projeto (necessita project_id ou project_name)
- `create_card` - Cria um novo card (necessita project_id, title, opcionalmente description, column_id, priority, due_date)
- `move_card` - Move um card para outra coluna (necessita card_id, column_id)
- `delete_card` - Apaga um card (necessita card_id e confirm: true)
- `search_cards` - Pesquisa cards por título ou descrição
- `get_card_comments` - Obtém comentários de um card

## Como Usar

- "Lista projetos" / "Mostra os projetos" → Use `list_projects`
- "Mostra cards do projeto [nome]" → Use `get_project_cards` com project_name
- "Cria um card 'Fix bug' no projeto 5" → Use `create_card` com project_id: 5, title: "Fix bug"
- "Move card 123 para coluna 'Done'" → Use `move_card` com card_id: 123, column_id do get_project_cards

Responde em Português ou no idioma preferido pelo utilizador.
```

#### Passo 3: Instalar a extensão no Gemini CLI

```bash
gemini extensions install ~/.gemini/extensions/anturio-boards
```

#### Passo 4: Reiniciar o Gemini CLI

Saia e volte a entrar no Gemini CLI para carregar a extensão.

---

## Como Usar a Skill

Após a configuração, podes usar os seguintes comandos no chat:

| Comando | Descrição |
|---------|-----------|
| `/anturioboards` | Invoca a skill manualmente |
| "Lista os meus projetos" | Lista todos os projetos |
| "Mostra os cards do projeto X" | Mostra as colunas e cards |
| "Cria um card 'Tarefa X'" | Cria um novo card |
| "Move o card 123 para 'Feito'" | Move um card para outra coluna |

---

## Resolução de Problemas

### A skill não aparece (Claude Code)?
- Verifique se o ficheiro `SKILL.md` está no caminho correto: `~/.claude/skills/anturioboards/SKILL.md`
- Reinicie o Claude Code

### A skill não aparece (Gemini CLI)?
- Execute `gemini skills list --all` para ver as skills disponíveis
- Verifique se a extensão está instalada: `gemini extensions`
- Tente reinstallar a extensão

### As ferramentas MCP não funcionam?
- Verifique se o MCP server está configurado corretamente
- Verifique se a API Key está correta
- Compile o MCP server: `cd mcp-server && npm run build`
- Reinicie a CLI

### Preciso de ajuda adicional?
- Consulte a documentação do Anturio Boards
- Entre em contacto com o suporte
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
---
description: Interage com o Anturio Boards - gestão de projetos e tarefas. Use quando o utilizador pedir para ver projetos, cards, criar tarefas, mover cards, ou interagir com o quadro Kanban.
---

## Ferramentas Disponíveis

- `list_projects` - Lista todos os projetos
- `get_project_cards` - Lista colunas e cartões (resumo apenas)
- `get_card` - **OBRIGATÓRIO para mostrar cartões** — conteúdo completo
- `search_cards` - Pesquisa cartões (usa `get_card` para mostrar ao utilizador)
- `create_card` - Cria um novo card
- `move_card` - Move um card para outra coluna
- `delete_card` - Apaga um card (necessita confirm: true)
- `get_card_comments` - Comentários (preferir `get_card`)

## REGRA DE OURO

Para **ver** ou **mostrar** um cartão: usa **`get_card`** e apresenta o output **integralmente**, sem resumir nem omitir conteúdo.

Responde em Português ou no idioma preferido pelo utilizador.

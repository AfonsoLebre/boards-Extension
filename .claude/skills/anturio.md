# Anturio Boards Skill

This skill helps you interact with Anturio Boards - a project management tool.

## Ferramentas disponíveis

- `list_projects` - Lista todos os projetos
- `get_project_cards` - Lista colunas e cartões (apenas resumo: título, ID, coluna, prioridade, membros)
- `get_card` - **OBRIGATÓRIO para mostrar cartões** — conteúdo completo com anexos materializados
- `get_card_attachment` - Abre/visualiza um anexo (imagem, texto ou link ABRIR)
- `search_cards` - Pesquisa cartões por título ou descrição (devolve IDs; usa `get_card` para detalhes)
- `create_card` - Cria um novo cartão
- `move_card` - Move um cartão para outra coluna
- `delete_card` - Apaga um cartão (requer confirm: true)
- `add_card_description` - Adiciona uma descrição a um cartão
- `update_card_description` - Edita título/conteúdo de uma descrição (usa descricao_index de get_card)
- `delete_card_description` - Apaga uma descrição (requer confirm: true; cartão deve ter >1 descrição)
- `add_card_checklist` - Adiciona uma checklist vazia
- `update_card_checklist` - Renomeia uma checklist (checklist_index de get_card)
- `delete_card_checklist` - Apaga uma checklist (requer confirm: true)
- `add_checklist_item` - Adiciona item a uma checklist
- `update_checklist_item` - Edita item (texto, completed, member_emails, add_member_emails)
- `delete_checklist_item` - Apaga item (requer confirm: true)
- `get_card_comments` - Apenas comentários (preferir `get_card` para conteúdo completo)

## REGRA DE OURO: mostrar SEMPRE o conteúdo COMPLETO

Quando o utilizador pedir para **ver**, **mostrar** ou **abrir** um cartão (ou cartões com detalhe):

1. Usa **`get_card`** com o `card_id` — nunca `get_project_cards` nem `search_cards` para apresentar conteúdo ao utilizador
2. Reproduz **integralmente** o output de `get_card` ao utilizador
3. **NÃO resumas**, **NÃO tronques**, **NÃO omitas** nada
4. **NÃO** substituas texto por "(vários parágrafos)", "texto longo", "..." ou "Lorem ipsum"
5. **NÃO** uses tabelas resumo quando o pedido é ver o cartão

### Fluxo correto

| Pedido do utilizador | Ferramenta |
|---------------------|------------|
| "Lista projetos" | `list_projects` |
| "Mostra os cartões do projeto X" (visão geral) | `get_project_cards` → depois `get_card` para cada cartão se pedir detalhe |
| "Mostra o cartão Y" / "Mostra-me o Card de Testes" | `get_project_cards` ou `search_cards` só para encontrar o ID → **`get_card`** |
| "Abre o anexo X do cartão" | `get_card_attachment` |
| "Adiciona uma descrição ao cartão" | `add_card_description` |
| "Edita a descrição 2 do cartão" | `update_card_description` com descricao_index |
| "Apaga a descrição X" | `delete_card_description` com confirm: true |
| "Adiciona checklist ao cartão" | `add_card_checklist` |
| "Renomeia checklist 2" | `update_card_checklist` com checklist_index |
| "Apaga checklist X" | `delete_card_checklist` com confirm: true |
| "Adiciona item à checklist" | `add_checklist_item` |
| "Adiciona membro X ao item" | `update_checklist_item` com **add_member_emails** (não member_emails) |
| "Marca item como feito" | `update_checklist_item` com completed: true |
| "Apaga item da checklist" | `delete_checklist_item` com confirm: true |
| "Mostra o cartão com todos os detalhes" | **`get_card`** diretamente |

### O que apresentar integralmente (de `get_card`)

- Todas as descrições completas, com imagens em **caminhos de ficheiro curtos** (`![...](.anturio/card-images/...)` ou `file:///...`) intercaladas no texto
- **Copia cada linha `![...](caminho)` na posição correta** — nunca uses base64, nunca digas "imagem embutida de X KB", nunca remetas para ficheiros de ferramenta MCP
- Todos os itens de checklists com estado (concluído / pendente) e membros atribuídos a cada item
- **Anexos:** imagens com `![nome](caminho)` + preview; texto com secção `CONTEUDO:`; outros com `ABRIR: [nome](caminho)` — copia tal como vem
- Todas as etiquetas e membros
- Todos os comentários
- Todo o histórico de atividades

Responde em Português ou no idioma preferido pelo utilizador.

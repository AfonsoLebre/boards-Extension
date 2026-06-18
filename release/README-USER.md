# Anturio Boards no Claude

Liga o Claude ao teu [Anturio Boards](https://boards.anturio.app) para ver e gerir projetos e cards a partir do chat.

> **Precisas da tua API Key.** Vai a https://boards.anturio.app → Perfil → "API Key". Começa por `ant_`.

---

## Claude Desktop (mais fácil)

1. Faz duplo clique em **`anturio-boards.mcpb`**.
2. O Claude Desktop abre o instalador → clica **Install**.
3. Cola a tua **API Key** quando pedir.
4. Pronto. Pergunta: *"lista os meus projetos do Anturio Boards"*.

Sem Node.js, sem terminal — o Desktop trata de tudo.

---

## Claude Code (CLI / VSCode)

Precisas de ter o **Node.js 18+** e o **Claude Code** instalados.

### Windows
1. Extrai o zip.
2. Na pasta extraída, abre o PowerShell e corre:
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
3. Cola a tua API Key quando pedir.

### macOS / Linux
1. Extrai o zip.
2. Na pasta extraída:
   ```sh
   sh install.sh
   ```
3. Cola a tua API Key quando pedir.

Depois **reinicia o Claude Code** (sessão nova) e pergunta: *"lista os meus projetos"*.

O instalador:
- copia o servidor MCP para `~/.anturio-boards/index.js`,
- instala a skill em `~/.claude/skills/anturioboards/`,
- regista o MCP server (`claude mcp add --scope user`) — fica disponível em **qualquer** projeto.

---

## O que podes pedir

| Exemplo | Faz |
|---------|-----|
| "Lista os meus projetos" | mostra todos os projetos |
| "Mostra os cards do projeto X" | colunas + cards |
| "Cria um card 'Corrigir bug' no projeto 5" | cria card |
| "Move o card 123 para Done" | move card |
| "Procura cards sobre faturação" | pesquisa |
| "Comentários do card 123" | lê comentários |

---

## Problemas

- **Tools não aparecem (Claude Code):** reinicia uma sessão nova. Confirma com `claude mcp list` → deve dar `anturio-boards: ✓ Connected`.
- **`node não encontrado`:** instala o Node.js (https://nodejs.org) e volta a correr o instalador.
- **API 401/403:** API Key errada ou expirada. Gera nova em boards.anturio.app.
- **Desktop não abre o `.mcpb`:** confirma que tens uma versão recente do Claude Desktop (suporte a Extensions/MCPB).

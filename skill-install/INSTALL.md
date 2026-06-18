# Tutorial: Instalar Anturio Boards como Skill

Este tutorial mostra como instalar a skill do Anturio Boards no Claude Code e Gemini CLI.

## Pré-requisitos

- Claude Code ou Gemini CLI instalado
- MCP server (opcional, necessário para as ferramentas funcionarem)

---

## Parte 1: Claude Code

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

## Parte 2: Gemini CLI

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
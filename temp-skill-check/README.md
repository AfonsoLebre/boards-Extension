# Anturio Boards Skill Package

Este pacote contém tudo o que precisas para usar a Anturio Boards como skill no Claude Code e Gemini CLI.

## Ficheiros

```
skill-install/
├── claude-code/
│   └── SKILL.md          → Skill para Claude Code
├── gemini-cli/
│   ├── gemini-extension.json
│   └── skills/
│       └── anturioboards/
│           └── SKILL.md  → Skill para Gemini CLI
└── INSTALL.md          → Instruções de instalação
```

## Instalação

### Claude Code

1. Copia `claude-code/SKILL.md` para `~/.claude/skills/anturioboards/SKILL.md`
2. (Opcional) Configura o MCP server em `~/.claude/settings.json`

### Gemini CLI

1. Copia a pasta `gemini-cli/` para `~/.gemini/extensions/anturio-boards/`
2. executa: `gemini extensions install ~/.gemini/extensions/anturio-boards`
3. (Opcional) Configura o MCP server em `~/.gemini/config/mcp_config.json`

## Como Usar

Escreve `/anturioboards` no chat para invocar a skill.

## Nota

O MCP server é necessário para as ferramentas funcionarem. Consulta a documentação da extensão VSCode para configurar.
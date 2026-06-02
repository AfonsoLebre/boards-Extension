#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listProjects, getProjectCards, createCard } from './api.js';

const server = new Server(
  { name: 'anturio-boards', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_projects',
      description: 'Lista todos os projetos do Anturio Boards a que o utilizador tem acesso.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_project_cards',
      description:
        'Devolve todas as colunas e cards de um projeto. Usa list_projects primeiro se não souberes o ID.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'ID numérico do projeto' },
          project_name: { type: 'string', description: 'Nome do projeto (alternativa ao ID — o servidor faz a correspondência)' },
        },
      },
    },
    {
      name: 'search_cards',
      description: 'Procura cards por título ou descrição em todos os projetos ou num projeto específico.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a procurar' },
          project_id: { type: 'number', description: 'Limitar a um projeto específico (opcional)' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Filtrar por prioridade (opcional)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_card',
      description: 'Cria um novo card num projeto. Usa list_projects para encontrar o project_id e get_project_cards para encontrar o column_id.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'ID do projeto' },
          title: { type: 'string', description: 'Título do card' },
          description: { type: 'string', description: 'Descrição detalhada (opcional)' },
          column_id: { type: 'string', description: 'ID da coluna — se omitido usa a primeira coluna do projeto' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Prioridade (default: medium)' },
          due_date: { type: 'string', description: 'Data limite no formato YYYY-MM-DD (opcional)' },
        },
        required: ['project_id', 'title'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'list_projects': {
        const projects = await listProjects();
        if (projects.length === 0) {
          return { content: [{ type: 'text', text: 'Não encontrei nenhum projeto.' }] };
        }
        const lines = projects.map(
          (p) => `• **${p.title}** (ID: ${p.id}) — ${p.workspace_name} | Responsável: ${p.manager}`,
        );
        return { content: [{ type: 'text', text: `**Projetos (${projects.length}):**\n\n${lines.join('\n')}` }] };
      }

      case 'get_project_cards': {
        const a = args as { project_id?: number; project_name?: string };
        let projectId = a.project_id;

        if (!projectId && a.project_name) {
          const projects = await listProjects();
          const match = projects.find((p) =>
            p.title.toLowerCase().includes(a.project_name!.toLowerCase()),
          );
          if (!match) {
            return { content: [{ type: 'text', text: `Projeto "${a.project_name}" não encontrado. Usa list_projects para ver os projetos disponíveis.` }] };
          }
          projectId = match.id;
        }

        if (!projectId) {
          return { content: [{ type: 'text', text: 'Indica o project_id ou project_name.' }] };
        }

        const { columns, cards } = await getProjectCards(projectId);
        const lines: string[] = [];

        for (const col of columns) {
          const colCards = cards.filter((c) => c.status === col.id);
          lines.push(`\n### ${col.title} (${colCards.length})`);
          if (colCards.length === 0) {
            lines.push('_Sem cards_');
          } else {
            for (const card of colCards) {
              const priority = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[card.priority] ?? '⚪';
              const due = card.due_date ? ` | prazo: ${card.due_date}` : '';
              const members = card.members.length > 0 ? ` | ${card.members.map((m) => m.name).join(', ')}` : '';
              lines.push(`- ${priority} **${card.title}** (ID: ${card.id})${due}${members}`);
              if (card.description) lines.push(`  _${card.description.slice(0, 100)}${card.description.length > 100 ? '…' : ''}_`);
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'search_cards': {
        const a = args as { query: string; project_id?: number; priority?: string };
        const projects = a.project_id
          ? [{ id: a.project_id }]
          : await listProjects();

        const results: Array<{ card: { id: number; title: string; description?: string; priority: string; status_label: string }; projectTitle: string }> = [];

        await Promise.all(
          projects.map(async (p) => {
            const { cards } = await getProjectCards(p.id);
            const q = a.query.toLowerCase();
            const filtered = cards.filter(
              (c) =>
                (c.title.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)) &&
                (!a.priority || c.priority === a.priority),
            );
            const title = 'title' in p ? (p as { title: string }).title : `Projeto ${p.id}`;
            filtered.forEach((c) => results.push({ card: c, projectTitle: title }));
          }),
        );

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `Nenhum card encontrado para "${a.query}".` }] };
        }

        const lines = results.map(({ card, projectTitle }) => {
          const priority = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[card.priority] ?? '⚪';
          return `- ${priority} **${card.title}** (${projectTitle} — ${card.status_label})`;
        });

        return { content: [{ type: 'text', text: `**${results.length} resultado(s):**\n\n${lines.join('\n')}` }] };
      }

      case 'create_card': {
        const a = args as {
          project_id: number;
          title: string;
          description?: string;
          column_id?: string;
          priority?: string;
          due_date?: string;
        };
        const card = await createCard(a.project_id, {
          title: a.title,
          description: a.description,
          columnId: a.column_id,
          priority: a.priority ?? 'medium',
          due_date: a.due_date,
        });
        return {
          content: [{
            type: 'text',
            text: `✅ Card criado: **${card.title}** (ID: ${card.id}) em *${card.status_label}*`,
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }] };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Erro: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Erro fatal: ${err}\n`);
  process.exit(1);
});

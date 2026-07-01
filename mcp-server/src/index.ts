#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response } from 'express';
import { listProjects, getProjectCards, createCard, moveCard, deleteCard, getCardComments, getCardDetails } from './api.js';

const TRANSPORT = process.env.TRANSPORT ?? 'stdio';
const PORT = parseInt(process.env.MCP_PORT ?? '3100', 10);

// Limpa HTML das descrições para texto simples
function cleanHtmlDescription(html: string): string {
  if (!html) return '';
  return html
    // Substitui parágrafos e divs por quebras de linha
    .replace(/<\/?(p|div|br)\s*\/?>/gi, '\n')
    // Substitui cabeçalhos
    .replace(/<\/?h[1-6][^>]*>/gi, '\n')
    // Substitui listas
    .replace(/<\/?(ul|li)\s*\/?>/gi, '\n')
    // Remove todas as tags HTML
    .replace(/<[^>]+>/g, '')
    // Remove encoded characters
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Remove base64 images
    .replace(/data:image\/[^;]+;base64,[^\s]*/gi, '[imagem]')
    // Limpa múltiplas quebras de linha
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const server = new Server(
  { name: 'anturio-boards', version: '0.1.0' },
  { capabilities: { tools: {}, logging: {} } },
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
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Filtrar por prioridade (opcional)' },
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
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Prioridade (default: normal)' },
          due_date: { type: 'string', description: 'Data limite no formato YYYY-MM-DD (opcional)' },
        },
        required: ['project_id', 'title'],
      },
    },
    {
      name: 'move_card',
      description: 'Move um card para outra coluna. Usa get_project_cards para ver os IDs das colunas.',
      inputSchema: {
        type: 'object',
        properties: {
          card_id: { type: 'number', description: 'ID do card a mover' },
          column_id: { type: 'string', description: 'ID da coluna de destino' },
        },
        required: ['card_id', 'column_id'],
      },
    },
    {
      name: 'delete_card',
      description: 'Apaga um card. Requer confirmação do utilizador — a AI deve perguntar antes de usar esta ferramenta.',
      inputSchema: {
        type: 'object',
        properties: {
          card_id: { type: 'number', description: 'ID do card a apagar' },
          confirm: { type: 'boolean', description: 'Deve ser true para confirmar a eliminação. A AI deve obter confirmação explícita do utilizador antes de definir como true.' },
        },
        required: ['card_id', 'confirm'],
      },
    },
    {
      name: 'get_card_comments',
      description: 'Mostra os comentários de um card. Usa get_project_cards para descobrir o ID do card.',
      inputSchema: {
        type: 'object',
        properties: {
          card_id: { type: 'number', description: 'ID do card' },
        },
        required: ['card_id'],
      },
    },
    {
      name: 'get_card',
      description: 'Mostra todos os detalhes de um card: título, descrição, checklists, anexos, membros, etiquetas, datas (início e limite), prioridade e coluna atual. Inclui também comentários e histórico de atividades.',
      inputSchema: {
        type: 'object',
        properties: {
          card_id: { type: 'number', description: 'ID do card' },
        },
        required: ['card_id'],
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
          lines.push(`\n### ${col.title} (Coluna ID: ${col.id}) — ${colCards.length} card(s)`);
          if (colCards.length === 0) {
            lines.push('_Sem cards_');
          } else {
            for (const card of colCards) {
              const priority = { low: '🔵', normal: '🟢', high: '🟠', critical: '🔴' }[card.priority] ?? '⚪';
              const due = card.due_date ? ` | prazo: ${card.due_date}` : '';
              const members = card.members.length > 0 ? ` | ${card.members.map((m) => m.name).join(', ')}` : '';
              lines.push(`- ${priority} **${card.title}** (ID: ${card.id})${due}${members}`);
              // Mostrar todas as descrições (do array descriptions ou do campo description simples)
              const allDescriptions: string[] = [];
              if (card.descriptions && card.descriptions.length > 0) {
                card.descriptions.forEach((d) => {
                  if (d.content && d.content.trim()) {
                    allDescriptions.push(d.content);
                  }
                });
              }
              if (allDescriptions.length === 0 && card.description) {
                allDescriptions.push(card.description);
              }
              allDescriptions.forEach((desc, i) => {
                const title = card.descriptions?.[i]?.title || 'Descrição';
                const cleanDesc = cleanHtmlDescription(desc);
                lines.push(`  _${title}: ${cleanDesc.slice(0, 15000)}${cleanDesc.length > 15000 ? '…' : ''}_`);
              });
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

        const results: Array<{ card: { id: number; title: string; description?: string; descriptions?: Array<{ id: number; title: string; content: string }>; priority: string; status_label: string }; projectTitle: string }> = [];

        await Promise.all(
          projects.map(async (p) => {
            const { cards } = await getProjectCards(p.id);
            const q = a.query.toLowerCase();
            // Verificar se a query está no título, description simples, ou em qualquer description do array
            const filtered = cards.filter(
              (c) => {
                if (c.title.toLowerCase().includes(q)) return true;
                if ((c.description ?? '').toLowerCase().includes(q)) return true;
                if (c.descriptions && c.descriptions.length > 0) {
                  for (const d of c.descriptions) {
                    if ((d.content ?? '').toLowerCase().includes(q)) return true;
                  }
                }
                return false;
              },
            );
            const title = 'title' in p ? (p as { title: string }).title : `Projeto ${p.id}`;
            filtered.forEach((c) => results.push({ card: c, projectTitle: title }));
          }),
        );

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `Nenhum card encontrado para "${a.query}".` }] };
        }

        const lines: string[] = [];
        results.forEach(({ card, projectTitle }) => {
          const priority = { low: '🔵', normal: '🟢', high: '🟠', critical: '🔴' }[card.priority] ?? '⚪';
          lines.push(`- ${priority} **${card.title}** (${projectTitle} — ${card.status_label})`);
          // Mostrar todas as descrições nos resultados da pesquisa
          const allDescriptions: string[] = [];
          if (card.descriptions && card.descriptions.length > 0) {
            card.descriptions.forEach((d) => {
              if (d.content && d.content.trim()) {
                allDescriptions.push(d.content);
              }
            });
          }
          if (allDescriptions.length === 0 && card.description) {
            allDescriptions.push(card.description);
          }
          allDescriptions.forEach((desc, i) => {
            const title = card.descriptions?.[i]?.title || 'Descrição';
            const cleanDesc = cleanHtmlDescription(desc);
            lines.push(`  _${title}: ${cleanDesc.slice(0, 15000)}${cleanDesc.length > 15000 ? '…' : ''}_`);
          });
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
        // Precisamos das colunas para o default e para resolver o nome (o POST de
        // criação não devolve status_label, por isso confiar nele dá "undefined").
        const { columns } = await getProjectCards(a.project_id);
        if (columns.length === 0) {
          return { content: [{ type: 'text', text: `O projeto ${a.project_id} não tem colunas. Não é possível criar o card.` }], isError: true };
        }
        // Se column_id omitido, usa a primeira coluna do projeto (a API não tem default).
        const columnId = a.column_id ?? columns[0].id;
        const card = await createCard(a.project_id, {
          title: a.title,
          description: a.description,
          columnId,
          priority: a.priority ?? 'normal',
          due_date: a.due_date,
        });
        const colLabel = columns.find((c) => c.id === columnId)?.title ?? card.status_label ?? columnId;
        return {
          content: [{
            type: 'text',
            text: `✅ Card criado: **${card.title}** (ID: ${card.id}) em *${colLabel}* (Coluna ID: ${columnId})`,
          }],
        };
      }

      case 'move_card': {
        const a = args as { card_id: number; column_id: string };
        const card = await moveCard(a.card_id, a.column_id);
        return {
          content: [{
            type: 'text',
            text: `✅ Card movido: **${card.title}** (ID: ${card.id}) para *${card.status_label}*`,
          }],
        };
      }

      case 'delete_card': {
        const a = args as { card_id: number; confirm: boolean };
        if (!a.confirm) {
          return {
            content: [{
              type: 'text',
              text: '⚠️ Confirmação necessária: vais apagar um card. Para confirmar, define confirm: true.',
              isError: true,
            }],
          };
        }
        await deleteCard(a.card_id);
        return {
          content: [{
            type: 'text',
            text: `🗑️ Card apagado (ID: ${a.card_id})`,
          }],
        };
      }

      case 'get_card_comments': {
        const a = args as { card_id: number };
        const comments = await getCardComments(a.card_id);
        if (comments.length === 0) {
          return { content: [{ type: 'text', text: 'Este card não tem comentários.' }] };
        }
        const lines = comments
          .filter((c) => c.type === 'comment')
          .map((c) => `**${c.user_name}** (${new Date(c.created_at).toLocaleString('pt-PT')}):\n${c.content}`);
        return { content: [{ type: 'text', text: `**Comentários (${lines.length}):**\n\n${lines.join('\n\n')}` }] };
      }

      case 'get_card': {
        const a = args as { card_id: number };
        const card = await getCardDetails(a.card_id);
        const comments = await getCardComments(a.card_id);

        const lines: string[] = [];

        // Título e ID
        lines.push(`## 📝 ${card.title} (ID: ${card.id})`);
        lines.push('');

        // Coluna/Status
        lines.push(`**Coluna:** ${card.status_label}`);
        lines.push('');

        // Prioridade
        const priorityIcons: Record<string, string> = { low: '🔵', normal: '🟢', high: '🟠', critical: '🔴' };
        lines.push(`**Prioridade:** ${priorityIcons[card.priority] || '⚪'} ${card.priority}`);
        lines.push('');

        // Datas
        if (card.start_date || card.due_date) {
          if (card.start_date) {
            lines.push(`**Data de Início:** ${card.start_date}`);
          }
          if (card.due_date) {
            lines.push(`**Data Limite:** ${card.due_date}`);
          }
          lines.push('');
        }

        // Membros
        if (card.members && card.members.length > 0) {
          const memberNames = card.members.map((m) => m.name || m.email).join(', ');
          lines.push(`**Membros:** ${memberNames}`);
          lines.push('');
        }

        // Etiquetas/Labels
        if (card.labels && card.labels.length > 0) {
          const labelTexts = card.labels.map((l) => `[${l.text}]`).join(' ');
          lines.push(`**Etiquetas:** ${labelTexts}`);
          lines.push('');
        }

        // Descrição principal
        if (card.description) {
          const cleanDesc = cleanHtmlDescription(card.description);
          if (cleanDesc) {
            lines.push('**Descrição:**');
            lines.push(cleanDesc);
            lines.push('');
          }
        }

        // Descrições adicionais
        if (card.descriptions && card.descriptions.length > 0) {
          lines.push('**Descrições Adicionais:**');
          for (const desc of card.descriptions) {
            const cleanContent = cleanHtmlDescription(desc.content);
            if (cleanContent) {
              lines.push(`\n### ${desc.title}`);
              lines.push(cleanContent);
            }
          }
          lines.push('');
        }

        // Checklists
        if (card.checklists && card.checklists.length > 0) {
          lines.push('**Checklists:**');
          for (const checklist of card.checklists) {
            // Safety check: ensure checklist and items exist
            const items = checklist.items || [];
            const completed = items.filter((i) => i && i.completed).length;
            const total = items.length;
            lines.push(`\n### ${checklist.title || 'Sem título'} (${completed}/${total})`);
            // Debug: show raw data if items seem wrong
            if (total === 0) {
              lines.push('_Checklist vazia_');
            } else if (total === 1 && items[0]) {
              // If only one item, show raw JSON for debugging
              lines.push(`_Debug - item: ${JSON.stringify(items[0])}_`);
            }
            for (const item of items) {
              if (item && item.title) {
                const check = item.completed ? '☑️' : '⬜';
                lines.push(`${check} ${item.title}`);
              }
            }
          }
          lines.push('');
        } else {
          lines.push('_Nenhuma checklist_');
        }

        // Anexos
        if (card.attachments && card.attachments.length > 0) {
          lines.push('**Anexos:**');
          for (const att of card.attachments) {
            // Safety: ensure attachment has required fields
            if (att && att.name && att.url) {
              const typeIcon = att.type?.startsWith('image/') ? '🖼️' : '📎';
              lines.push(`- ${typeIcon} [${att.name}](${att.url})`);
            }
          }
          lines.push('');
        }

        // Comentários e Histórico
        if (comments.length > 0) {
          const commentItems = comments.filter((c) => c.type === 'comment');
          const historyItems = comments.filter((c) => c.type !== 'comment');

          lines.push(`**Comentários e Histórico (${comments.length}):**`);

          for (const c of comments) {
            const dateStr = new Date(c.created_at).toLocaleString('pt-PT');
            if (c.type === 'comment') {
              lines.push(`\n💬 **${c.user_name}** (${dateStr}):\n${c.content}`);
            } else {
              const iconMap: Record<string, string> = {
                card_created: '✨',
                status_changed: '📍',
                moved: '➡️',
                priority_changed: '🔢',
                comment: '💬',
              };
              const icon = iconMap[c.type] || '📋';
              lines.push(`\n${icon} **${c.user_name}** (${dateStr}) — ${c.type}:\n${c.content}`);
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
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
  const API_KEY = process.env.ANTURIO_API_KEY ?? '';
  const SERVER_URL = process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3000';

  if (!API_KEY) {
    process.stderr.write('ERRO: ANTURIO_API_KEY não definida\n');
    process.exit(1);
  }

  process.stderr.write(`[MCP] Anturio Boards MCP Server v0.1.0 iniciando...\n`);
  process.stderr.write(`[MCP] Transport: ${TRANSPORT}\n`);
  process.stderr.write(`[MCP] Server URL: ${SERVER_URL}\n`);

  if (TRANSPORT === 'http') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const app = express();
    app.use(express.json());
    app.post('/mcp', (req: Request, res: Response) => transport.handleRequest(req, res, req.body));
    app.get('/sse', (req: Request, res: Response) => transport.handleRequest(req, res));
    app.get('/', (_req: Request, res: Response) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Anturio Boards MCP Server — POST to /mcp');
    });
    const server = app.listen(PORT, () => {
      process.stderr.write(`[MCP] HTTP server pronto em http://localhost:${PORT}/mcp\n`);
    });
    await new Promise<void>((resolve) => server.on('close', resolve));
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[MCP] Servidor stdio conectado e pronto\n`);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  process.stderr.write(`[MCP] ERRO: Promise rejection não tratada: ${reason}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[MCP] ERRO: Exceção não capturada: ${err}\n`);
  process.exit(1);
});

main().catch((err) => {
  process.stderr.write(`[MCP] ERRO FATAL ao iniciar: ${err}\n`);
  if (err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});

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
import { parseDescriptionContent, type ToolContent } from './descriptionMedia.js';
import { materializeAllAttachments, materializeAttachment } from './attachmentMedia.js';

const TRANSPORT = process.env.TRANSPORT ?? 'stdio';
const PORT = parseInt(process.env.MCP_PORT ?? '3100', 10);

function formatCardSummaryLine(card: {
  id: number;
  title: string;
  priority: string;
  status_label: string;
  due_date?: string;
  members: Array<{ name: string }>;
}): string {
  const priority = { low: '🔵', normal: '🟢', high: '🟠', critical: '🔴' }[card.priority] ?? '⚪';
  const due = card.due_date ? ` | prazo: ${card.due_date}` : '';
  const members = card.members.length > 0 ? ` | ${card.members.map((m) => m.name).join(', ')}` : '';
  return `- ${priority} **${card.title}** (ID: ${card.id}) | ${card.status_label}${due}${members}`;
}

function collectDescriptions(card: {
  description?: string;
  descriptions?: Array<{ title: string; content: string }>;
}): Array<{ title: string; content: string }> {
  const result: Array<{ title: string; content: string }> = [];
  if (card.descriptions?.length) {
    for (const d of card.descriptions) {
      if (d.content?.trim()) {
        result.push({ title: d.title || 'Descrição', content: d.content });
      }
    }
  }
  if (result.length === 0 && card.description?.trim()) {
    result.push({ title: 'Descrição', content: card.description });
  }
  return result;
}

function getChecklistItemMembers(item: {
  assignedMembers?: Array<{ name?: string; email?: string }>;
  assigned_members?: Array<{ name?: string; email?: string }>;
  members?: Array<{ name?: string; email?: string }>;
}): Array<{ name?: string; email?: string }> {
  return item.assignedMembers ?? item.assigned_members ?? item.members ?? [];
}

function formatChecklistItemMembers(item: {
  assignedMembers?: Array<{ name?: string; email?: string }>;
  assigned_members?: Array<{ name?: string; email?: string }>;
  members?: Array<{ name?: string; email?: string }>;
}): string {
  const members = getChecklistItemMembers(item);
  if (members.length === 0) return 'Membros: Nenhum';
  return `Membros: ${members.map((m) => m.name || m.email || '?').join(', ')}`;
}

const LIST_CARDS_HEADER =
  'NOTA: Esta é uma listagem resumida. Para mostrar o conteúdo COMPLETO de um cartão (descrições, checklists, anexos, comentários, histórico), usa get_card com o card_id. A AI deve reproduzir o output de get_card integralmente, sem resumir.';

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
        'Lista colunas e cartões de um projeto (título, ID, coluna, prioridade, membros). NÃO inclui descrições, checklists, anexos nem comentários. Para mostrar o conteúdo COMPLETO de um cartão ao utilizador, usa get_card com o card_id.',
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
      description:
        'Procura cartões por título ou descrição. Devolve correspondências com ID. Para mostrar o conteúdo COMPLETO ao utilizador, usa get_card com o card_id encontrado.',
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
      name: 'get_card_attachment',
      description:
        'Abre/visualiza um anexo de um cartão. Imagens: preview + caminho local. Texto: conteúdo completo. Outros: caminho local para abrir. Usa get_card para listar anexos (índice começa em 1).',
      inputSchema: {
        type: 'object',
        properties: {
          card_id: { type: 'number', description: 'ID do cartão' },
          attachment_index: { type: 'number', description: 'Índice do anexo (1 = primeiro)' },
          attachment_name: { type: 'string', description: 'Nome do anexo (alternativa ao índice)' },
        },
        required: ['card_id'],
      },
    },
    {
      name: 'get_card',
      description:
        'OBRIGATÓRIO para mostrar um cartão ao utilizador. Imagens nas descrições e anexos de imagem usam caminhos locais curtos. Anexos de texto incluem CONTEUDO; outros têm link ABRIR. Usa get_card_attachment para ver um anexo específico. Reproduz caminhos ![...](...) e [nome](caminho) tal como vêm.',
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
        const lines: string[] = [LIST_CARDS_HEADER];

        for (const col of columns) {
          const colCards = cards.filter((c) => c.status === col.id);
          lines.push(`\n### ${col.title} (Coluna ID: ${col.id}) — ${colCards.length} card(s)`);
          if (colCards.length === 0) {
            lines.push('_Sem cards_');
          } else {
            for (const card of colCards) {
              lines.push(formatCardSummaryLine(card));
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

        const results: Array<{ card: { id: number; title: string; description?: string; descriptions?: Array<{ id: number; title: string; content: string }>; priority: string; status_label: string; due_date?: string; members: Array<{ name: string }> }; projectTitle: string }> = [];

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

        const lines: string[] = [LIST_CARDS_HEADER, `**${results.length} resultado(s):**`];
        results.forEach(({ card, projectTitle }) => {
          lines.push(formatCardSummaryLine({ ...card, status_label: `${projectTitle} — ${card.status_label}` }));
        });

        return { content: [{ type: 'text', text: lines.join('\n') }] };
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
        let comments: Awaited<ReturnType<typeof getCardComments>> = [];
        try {
          comments = await getCardComments(a.card_id);
        } catch {
          // Comentários são opcionais se o endpoint de atividades não estiver disponível.
        }

        const header: string[] = [];

        // Secção 1: Identidade
        header.push(`CARTAO: ${card.title} (ID: ${card.id})`);

        // Secção 2: Estado Básico
        const priorityMap: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', critical: 'Critica' };
        header.push(`COLUNA: ${card.status_label || 'N/A'}`);
        header.push(`PRIORIDADE: ${priorityMap[card.priority] || card.priority}`);

        if (card.start_date) header.push(`DATA INICIO: ${card.start_date}`);
        if (card.due_date) header.push(`DATA FIM: ${card.due_date}`);

        if (card.members && card.members.length > 0) {
          header.push(`MEMBROS: ${card.members.map((m) => m.name || m.email).join(', ')}`);
        } else {
          header.push('MEMBROS: Nenhum');
        }

        if (card.labels && card.labels.length > 0) {
          header.push(`ETIQUETAS: ${card.labels.map((l) => l.text).join(', ')}`);
        } else {
          header.push('ETIQUETAS: Nenhuma');
        }

        header.push('---');

        const content: ToolContent[] = [{ type: 'text', text: header.join('\n') }];

        // Secção 5: DESCRIÇÃO (texto + imagens intercalados)
        const descriptions = collectDescriptions(card);
        if (descriptions.length > 0) {
          content.push({
            type: 'text',
            text: 'DESCRICAO:\nNOTA_IMAGENS: As imagens estão em ficheiros locais. Copia cada linha ![...](caminho) para o chat na mesma posição — não uses base64 nem descrevas o tamanho da imagem.',
          });
          for (const d of descriptions) {
            content.push({ type: 'text', text: `[${d.title}]` });
            content.push(...parseDescriptionContent(d.content, card.id));
          }
        } else {
          content.push({ type: 'text', text: 'DESCRICAO: Nenhuma' });
        }

        const footer: string[] = ['---'];

        // Secção 6: CHECKLISTS
        if (card.checklists && card.checklists.length > 0) {
          footer.push('CHECKLISTS:');
          for (const cl of card.checklists) {
            const items = cl.items || [];
            const done = items.filter((i) => i && (i.completed || i.checked)).length;
            footer.push(`CHECKLIST: ${cl.title || 'Sem titulo'} (${done}/${items.length})`);
            if (items.length === 0) {
              footer.push('  - (vazia)');
            } else {
              for (const item of items) {
                if (!item) continue;
                const txt = item.text || item.title;
                const isDone = item.completed || item.checked;
                if (txt) {
                  footer.push(`  - [${isDone ? 'X' : ' '}] ${txt} | ${formatChecklistItemMembers(item)}`);
                }
              }
            }
          }
        } else {
          footer.push('CHECKLISTS: Nenhuma');
        }
        footer.push('---');

        content.push({ type: 'text', text: footer.join('\n') });

        // Secção 7: Anexos (materializados com preview)
        if (card.attachments && card.attachments.length > 0) {
          content.push({
            type: 'text',
            text: 'ANEXOS:\nNOTA_ANEXOS: Imagens têm preview; ficheiros de texto mostram CONTEUDO; outros têm link ABRIR. Copia os caminhos para o utilizador abrir/ver.',
          });
          content.push(...(await materializeAllAttachments(card.id, card.attachments)));
        } else {
          content.push({ type: 'text', text: 'ANEXOS: Nenhum' });
        }

        const tail: string[] = ['---'];

        // Secção 8: Comentários
        const realComments = comments.filter((c) => c.type === 'comment');
        if (realComments.length > 0) {
          tail.push('COMENTARIOS:');
          for (const c of realComments) {
            const dateStr = new Date(c.created_at).toLocaleString('pt-PT');
            tail.push(`  ${c.user_name} (${dateStr}): ${c.content}`);
          }
        } else {
          tail.push('COMENTARIOS: Nenhum');
        }
        tail.push('---');

        // Secção 9: Histórico
        const history = comments.filter((c) => c.type !== 'comment');
        if (history.length > 0) {
          tail.push('HISTORICO:');
          for (const h of history) {
            const dateStr = new Date(h.created_at).toLocaleString('pt-PT');
            tail.push(`  ${h.type} por ${h.user_name} em ${dateStr}`);
          }
        } else {
          tail.push('HISTORICO: Nenhum');
        }

        content.push({ type: 'text', text: tail.join('\n') });
        return { content };
      }

      case 'get_card_attachment': {
        const a = args as { card_id: number; attachment_index?: number; attachment_name?: string };
        const card = await getCardDetails(a.card_id);
        const attachments = card.attachments ?? [];

        if (attachments.length === 0) {
          return { content: [{ type: 'text', text: 'Este cartão não tem anexos.' }] };
        }

        let index = a.attachment_index !== undefined ? a.attachment_index - 1 : -1;
        if (index < 0 && a.attachment_name) {
          const q = a.attachment_name.toLowerCase();
          index = attachments.findIndex((att) => att.name.toLowerCase().includes(q));
        }
        if (index < 0 && a.attachment_index === undefined && !a.attachment_name) {
          const lines = attachments.map((att, i) => `${i + 1}. ${att.name}`);
          return {
            content: [{
              type: 'text',
              text: `Indica attachment_index (1-${attachments.length}) ou attachment_name.\n\nAnexos:\n${lines.join('\n')}`,
            }],
          };
        }
        if (index < 0 || index >= attachments.length) {
          return {
            content: [{ type: 'text', text: 'Anexo não encontrado. Usa get_card para ver a lista de anexos.' }],
            isError: true,
          };
        }

        const att = attachments[index];
        const content = await materializeAttachment(card.id, index, att);
        return { content };
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

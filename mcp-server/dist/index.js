#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { listProjects, getProjectCards, createCard, moveCard, deleteCard, getCardComments } from './api.js';
const TRANSPORT = process.env.TRANSPORT ?? 'stdio';
const PORT = parseInt(process.env.MCP_PORT ?? '3100', 10);
// Limpa HTML das descrições para texto simples
function cleanHtmlDescription(html) {
    if (!html)
        return '';
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
const server = new Server({ name: 'anturio-boards', version: '0.1.0' }, { capabilities: { tools: {}, logging: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'list_projects',
            description: 'Lista todos os projetos do Anturio Boards a que o utilizador tem acesso.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'get_project_cards',
            description: 'Devolve todas as colunas e cards de um projeto. Usa list_projects primeiro se não souberes o ID.',
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
                const lines = projects.map((p) => `• **${p.title}** (ID: ${p.id}) — ${p.workspace_name} | Responsável: ${p.manager}`);
                return { content: [{ type: 'text', text: `**Projetos (${projects.length}):**\n\n${lines.join('\n')}` }] };
            }
            case 'get_project_cards': {
                const a = args;
                let projectId = a.project_id;
                if (!projectId && a.project_name) {
                    const projects = await listProjects();
                    const match = projects.find((p) => p.title.toLowerCase().includes(a.project_name.toLowerCase()));
                    if (!match) {
                        return { content: [{ type: 'text', text: `Projeto "${a.project_name}" não encontrado. Usa list_projects para ver os projetos disponíveis.` }] };
                    }
                    projectId = match.id;
                }
                if (!projectId) {
                    return { content: [{ type: 'text', text: 'Indica o project_id ou project_name.' }] };
                }
                const { columns, cards } = await getProjectCards(projectId);
                const lines = [];
                for (const col of columns) {
                    const colCards = cards.filter((c) => c.status === col.id);
                    lines.push(`\n### ${col.title} (${colCards.length})`);
                    if (colCards.length === 0) {
                        lines.push('_Sem cards_');
                    }
                    else {
                        for (const card of colCards) {
                            const priority = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[card.priority] ?? '⚪';
                            const due = card.due_date ? ` | prazo: ${card.due_date}` : '';
                            const members = card.members.length > 0 ? ` | ${card.members.map((m) => m.name).join(', ')}` : '';
                            lines.push(`- ${priority} **${card.title}** (ID: ${card.id})${due}${members}`);
                            // Mostrar todas as descrições (do array descriptions ou do campo description simples)
                            const allDescriptions = [];
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
                const a = args;
                const projects = a.project_id
                    ? [{ id: a.project_id }]
                    : await listProjects();
                const results = [];
                await Promise.all(projects.map(async (p) => {
                    const { cards } = await getProjectCards(p.id);
                    const q = a.query.toLowerCase();
                    // Verificar se a query está no título, description simples, ou em qualquer description do array
                    const filtered = cards.filter((c) => {
                        if (c.title.toLowerCase().includes(q))
                            return true;
                        if ((c.description ?? '').toLowerCase().includes(q))
                            return true;
                        if (c.descriptions && c.descriptions.length > 0) {
                            for (const d of c.descriptions) {
                                if ((d.content ?? '').toLowerCase().includes(q))
                                    return true;
                            }
                        }
                        return false;
                    });
                    const title = 'title' in p ? p.title : `Projeto ${p.id}`;
                    filtered.forEach((c) => results.push({ card: c, projectTitle: title }));
                }));
                if (results.length === 0) {
                    return { content: [{ type: 'text', text: `Nenhum card encontrado para "${a.query}".` }] };
                }
                const lines = [];
                results.forEach(({ card, projectTitle }) => {
                    const priority = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[card.priority] ?? '⚪';
                    lines.push(`- ${priority} **${card.title}** (${projectTitle} — ${card.status_label})`);
                    // Mostrar todas as descrições nos resultados da pesquisa
                    const allDescriptions = [];
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
                const a = args;
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
            case 'move_card': {
                const a = args;
                const card = await moveCard(a.card_id, a.column_id);
                return {
                    content: [{
                            type: 'text',
                            text: `✅ Card movido: **${card.title}** (ID: ${card.id}) para *${card.status_label}*`,
                        }],
                };
            }
            case 'delete_card': {
                const a = args;
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
                const a = args;
                const comments = await getCardComments(a.card_id);
                if (comments.length === 0) {
                    return { content: [{ type: 'text', text: 'Este card não tem comentários.' }] };
                }
                const lines = comments
                    .filter((c) => c.type === 'comment')
                    .map((c) => `**${c.user_name}** (${new Date(c.created_at).toLocaleString('pt-PT')}):\n${c.content}`);
                return { content: [{ type: 'text', text: `**Comentários (${lines.length}):**\n\n${lines.join('\n\n')}` }] };
            }
            default:
                return { content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }] };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erro: ${msg}` }], isError: true };
    }
});
async function main() {
    if (TRANSPORT === 'http') {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });
        const app = express();
        app.use(express.json());
        app.post('/mcp', (req, res) => transport.handleRequest(req, res, req.body));
        app.get('/sse', (req, res) => transport.handleRequest(req, res));
        app.get('/', (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Anturio Boards MCP Server — POST to /mcp');
        });
        const server = app.listen(PORT, () => console.error(`Anturio Boards MCP running on http://localhost:${PORT}/mcp`));
        await new Promise((resolve) => server.on('close', resolve));
    }
    else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}
main().catch((err) => {
    process.stderr.write(`Erro fatal: ${err}\n`);
    process.exit(1);
});

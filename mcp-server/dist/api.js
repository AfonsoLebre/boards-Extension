const SERVER_URL = (process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.ANTURIO_API_KEY ?? '';
async function request(method, path, body) {
    if (!API_KEY)
        throw new Error('ANTURIO_API_KEY não definida. Configura a variável de ambiente.');
    const res = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY,
            'User-Agent': 'anturio-mcp/0.1.0',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
}
/** Tenta vários paths GET até um responder (útil entre produção e dev local). */
async function requestGetFirst(paths) {
    let lastError = null;
    for (const path of paths) {
        try {
            return await request('GET', path);
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            lastError = error;
            if (!error.message.startsWith('API 404')) {
                throw error;
            }
        }
    }
    throw lastError ?? new Error('Nenhum endpoint disponível para este pedido.');
}
async function requestWriteFirst(method, paths, body) {
    let lastError = null;
    for (const path of paths) {
        try {
            return await request(method, path, body);
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            lastError = error;
            if (!error.message.startsWith('API 404')) {
                throw error;
            }
        }
    }
    throw lastError ?? new Error('Nenhum endpoint disponível para este pedido.');
}
export function getDescriptionsList(card) {
    if (card.descriptions?.length) {
        return card.descriptions.map((d) => ({
            id: d.id,
            title: d.title || 'Descrição',
            content: d.content ?? '',
        }));
    }
    if (card.description?.trim()) {
        return [{ title: 'Descrição', content: card.description }];
    }
    return [];
}
export async function updateCardRaw(cardId, payload) {
    return requestWriteFirst('PUT', [
        `/api/tarefas/${cardId}`,
        `/server-api/api/tarefas/${cardId}`,
    ], payload);
}
export async function addCardDescription(cardId, title, content = '') {
    const card = await getCardDetails(cardId);
    const descriptions = getDescriptionsList(card);
    descriptions.push({ title, content });
    return updateCardRaw(cardId, { descriptions });
}
export async function updateCardDescription(cardId, descriptionIndex, updates) {
    const card = await getCardDetails(cardId);
    const descriptions = getDescriptionsList(card);
    const idx = descriptionIndex - 1;
    if (idx < 0 || idx >= descriptions.length) {
        throw new Error(`Descrição ${descriptionIndex} não encontrada (total: ${descriptions.length})`);
    }
    if (updates.title !== undefined)
        descriptions[idx].title = updates.title;
    if (updates.content !== undefined)
        descriptions[idx].content = updates.content;
    return updateCardRaw(cardId, { descriptions });
}
export async function deleteCardDescription(cardId, descriptionIndex) {
    const card = await getCardDetails(cardId);
    const descriptions = getDescriptionsList(card);
    if (descriptions.length <= 1) {
        throw new Error('Não é possível apagar a única descrição do cartão');
    }
    const idx = descriptionIndex - 1;
    if (idx < 0 || idx >= descriptions.length) {
        throw new Error(`Descrição ${descriptionIndex} não encontrada (total: ${descriptions.length})`);
    }
    descriptions.splice(idx, 1);
    return updateCardRaw(cardId, { descriptions });
}
export async function fetchAttachmentBinary(url) {
    const fullUrl = url.startsWith('http') ? url : url.startsWith('/') ? `${SERVER_URL}${url}` : url;
    const res = await fetch(fullUrl, {
        headers: {
            'X-API-Key': API_KEY,
            'User-Agent': 'anturio-mcp/0.1.0',
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Download do anexo falhou (${res.status}): ${text}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    return { buffer, mimeType };
}
export async function listProjects() {
    const data = await request('GET', '/api/v1/projects');
    return data.projects;
}
export async function getProjectCards(projectId) {
    const data = await request('GET', `/api/v1/projects/${projectId}/cards`);
    return { columns: data.columns, cards: data.cards };
}
export async function createCard(projectId, payload) {
    // O endpoint de criação usa `status` para a coluna (no modelo, card.status === column.id).
    // Enviamos também `columnId` por compatibilidade.
    const body = {
        title: payload.title,
        description: payload.description,
        status: payload.columnId,
        columnId: payload.columnId,
        priority: payload.priority,
        due_date: payload.due_date,
    };
    return request('POST', `/api/v1/projects/${projectId}/cards`, body);
}
export async function moveCard(cardId, columnId) {
    return request('PATCH', `/api/v1/cards/${cardId}`, { columnId });
}
export async function deleteCard(cardId) {
    await request('DELETE', `/api/v1/cards/${cardId}`);
}
export async function getCardComments(cardId) {
    return requestGetFirst([
        `/api/tarefas/${cardId}/activities`,
        `/api/v1/cards/${cardId}/activities`,
        `/server-api/api/tarefas/${cardId}/activities`,
    ]);
}
export async function getCardDetails(cardId) {
    try {
        return await requestGetFirst([
            `/api/tarefas/${cardId}`,
            `/server-api/api/tarefas/${cardId}`,
            `/api/v1/cards/${cardId}`,
        ]);
    }
    catch {
        const projects = await listProjects();
        for (const project of projects) {
            const { cards } = await getProjectCards(project.id);
            const card = cards.find((c) => c.id === cardId);
            if (card)
                return card;
        }
        throw new Error(`Card ${cardId} não encontrado.`);
    }
}

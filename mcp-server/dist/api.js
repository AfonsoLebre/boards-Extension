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
export async function listProjects() {
    const data = await request('GET', '/api/v1/projects');
    return data.projects;
}
export async function getProjectCards(projectId) {
    const data = await request('GET', `/api/v1/projects/${projectId}/cards`);
    return { columns: data.columns, cards: data.cards };
}
export async function createCard(projectId, payload) {
    return request('POST', `/api/v1/projects/${projectId}/cards`, payload);
}

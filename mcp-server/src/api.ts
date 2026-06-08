const SERVER_URL = (process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API_KEY = process.env.ANTURIO_API_KEY ?? '';

export interface Project {
  id: number;
  title: string;
  manager: string;
  workspace_id: number;
  workspace_name: string;
  created_at: string;
}

export interface Column {
  id: string;
  title: string;
}

export interface Card {
  id: number;
  title: string;
  description?: string;
  status: string;
  status_label: string;
  priority: string;
  start_date?: string;
  due_date?: string;
  members: Array<{ email: string; name: string }>;
  labels: Array<{ text: string; color: string }>;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_KEY) throw new Error('ANTURIO_API_KEY não definida. Configura a variável de ambiente.');

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

  return res.json() as Promise<T>;
}

export async function listProjects(): Promise<Project[]> {
  const data = await request<{ projects: Project[] }>('GET', '/api/v1/projects');
  return data.projects;
}

export async function getProjectCards(projectId: number): Promise<{ columns: Column[]; cards: Card[] }> {
  const data = await request<{ project_id: number; columns: Column[]; cards: Card[] }>(
    'GET',
    `/api/v1/projects/${projectId}/cards`,
  );
  return { columns: data.columns, cards: data.cards };
}

export async function createCard(
  projectId: number,
  payload: {
    title: string;
    description?: string;
    columnId?: string;
    priority?: string;
    due_date?: string;
  },
): Promise<Card> {
  return request<Card>('POST', `/api/v1/projects/${projectId}/cards`, payload);
}

const SERVER_URL = (process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
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

export interface CardDescription {
  id: number;
  title: string;
  content: string;
}

export interface CardChecklistItemMember {
  email?: string;
  name?: string;
  icon_url?: string;
}

export interface CardChecklistItem {
  id: string;
  title?: string;
  text?: string;
  completed?: boolean;
  checked?: boolean;
  assignedMembers?: CardChecklistItemMember[];
  assigned_members?: CardChecklistItemMember[];
  members?: CardChecklistItemMember[];
}

export interface CardChecklist {
  id: string;
  title: string;
  items: CardChecklistItem[];
}

export interface CardAttachment {
  id?: string;
  name: string;
  url: string;
  type?: string;
}

export interface Card {
  id: number;
  title: string;
  description?: string;
  descriptions?: CardDescription[];
  status: string;
  status_label: string;
  priority: string;
  start_date?: string;
  due_date?: string;
  members: Array<{ email: string; name: string; icon_url?: string }>;
  labels: Array<{ text: string; color: string }>;
  checklists?: CardChecklist[];
  attachments?: CardAttachment[];
  cover?: string;
  project_id?: number;
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

/** Tenta vários paths GET até um responder (útil entre produção e dev local). */
async function requestGetFirst<T>(paths: string[]): Promise<T> {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      return await request<T>('GET', path);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      if (!error.message.startsWith('API 404')) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error('Nenhum endpoint disponível para este pedido.');
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
  return request<Card>('POST', `/api/v1/projects/${projectId}/cards`, body);
}

export async function moveCard(cardId: number, columnId: string): Promise<Card> {
  return request<Card>('PATCH', `/api/v1/cards/${cardId}`, { columnId });
}

export async function deleteCard(cardId: number): Promise<void> {
  await request<void>('DELETE', `/api/v1/cards/${cardId}`);
}

export interface CardComment {
  id: number;
  user_email: string;
  user_name: string;
  type: string;
  content: string;
  created_at: string;
}

export async function getCardComments(cardId: number): Promise<CardComment[]> {
  return requestGetFirst<CardComment[]>([
    `/api/tarefas/${cardId}/activities`,
    `/api/v1/cards/${cardId}/activities`,
    `/server-api/api/tarefas/${cardId}/activities`,
  ]);
}

export async function getCardDetails(cardId: number): Promise<Card> {
  try {
    return await requestGetFirst<Card>([
      `/api/tarefas/${cardId}`,
      `/server-api/api/tarefas/${cardId}`,
      `/api/v1/cards/${cardId}`,
    ]);
  } catch {
    const projects = await listProjects();
    for (const project of projects) {
      const { cards } = await getProjectCards(project.id);
      const card = cards.find((c) => c.id === cardId);
      if (card) return card;
    }
    throw new Error(`Card ${cardId} não encontrado.`);
  }
}

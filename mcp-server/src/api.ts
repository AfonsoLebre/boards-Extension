const SERVER_URL = (process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.ANTURIO_API_KEY ?? '';

export function resolveServerUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }
  if (path.startsWith('/')) {
    return `${SERVER_URL}${path}`;
  }
  return path;
}

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
  avatar?: string;
  icon?: string;
  user_icon?: string;
}

export interface CardChecklistItem {
  id?: string;
  title?: string;
  text?: string;
  completed?: boolean;
  checked?: boolean;
  assignedMembers?: CardChecklistItemMember[];
  assigned_members?: CardChecklistItemMember[];
  members?: CardChecklistItemMember[];
}

export interface CardChecklist {
  id?: string;
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
  members: Array<{ email: string; name: string; icon_url?: string; avatar?: string; icon?: string; user_icon?: string }>;
  labels: Array<{ text: string; color: string }>;
  checklists?: CardChecklist[];
  attachments?: CardAttachment[];
  cover?: string;
  project_id?: number;
  archived?: boolean;
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

async function requestWriteFirst<T>(method: string, paths: string[], body?: unknown): Promise<T> {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      return await request<T>(method, path, body);
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

export type DescriptionInput = { id?: number; title: string; content: string };

export function getDescriptionsList(card: Card): DescriptionInput[] {
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

export async function updateCardRaw(cardId: number, payload: Record<string, unknown>): Promise<Card> {
  return requestWriteFirst<Card>('PUT', [
    `/api/tarefas/${cardId}`,
    `/server-api/api/tarefas/${cardId}`,
  ], payload);
}

export async function addCardDescription(
  cardId: number,
  title: string,
  content = '',
): Promise<Card> {
  const card = await getCardDetails(cardId);
  const descriptions = getDescriptionsList(card);
  descriptions.push({ title, content });
  return updateCardRaw(cardId, { descriptions });
}

export async function updateCardDescription(
  cardId: number,
  descriptionIndex: number,
  updates: { title?: string; content?: string },
): Promise<Card> {
  const card = await getCardDetails(cardId);
  const descriptions = getDescriptionsList(card);
  const idx = descriptionIndex - 1;
  if (idx < 0 || idx >= descriptions.length) {
    throw new Error(`Descrição ${descriptionIndex} não encontrada (total: ${descriptions.length})`);
  }
  if (updates.title !== undefined) descriptions[idx].title = updates.title;
  if (updates.content !== undefined) descriptions[idx].content = updates.content;
  return updateCardRaw(cardId, { descriptions });
}

export async function deleteCardDescription(cardId: number, descriptionIndex: number): Promise<Card> {
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

type CardMemberPayload = { email: string; name: string; icon_url?: string };

export async function addCardMembers(cardId: number, emails: string[]): Promise<Card> {
  const uniqueEmails = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
  if (uniqueEmails.length === 0) {
    throw new Error('Indica pelo menos um email');
  }

  const card = await getCardDetails(cardId);
  const currentMembers = [...(card.members ?? [])];
  const existingEmails = new Set(currentMembers.map((m) => m.email.toLowerCase()));

  const cardWithProject = await ensureCardProjectId(card);
  let participants: ProjectParticipant[] = [];
  if (cardWithProject.project_id) {
    participants = await getProjectParticipantsEnriched(cardWithProject.project_id);
  }

  const toAdd: CardMemberPayload[] = [];
  const skipped: string[] = [];
  for (const email of uniqueEmails) {
    const lower = email.toLowerCase();
    if (existingEmails.has(lower)) {
      skipped.push(email);
      continue;
    }
    const participant = participants.find((p) => p.email?.toLowerCase() === lower);
    const newMember: CardMemberPayload = {
      email,
      name: participant?.name || email,
    };
    if (participant?.icon_url) {
      newMember.icon_url = participant.icon_url;
    }
    toAdd.push(newMember);
    existingEmails.add(lower);
  }

  if (toAdd.length === 0) {
    throw new Error(
      skipped.length === uniqueEmails.length
        ? 'Todos os utilizadores indicados já são membros do cartão'
        : 'Nenhum membro novo a adicionar',
    );
  }

  return updateCardRaw(cardId, { members: [...currentMembers, ...toAdd] });
}

export async function removeCardMembers(cardId: number, emails: string[]): Promise<Card> {
  const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (uniqueEmails.length === 0) {
    throw new Error('Indica pelo menos um email');
  }

  const card = await getCardDetails(cardId);
  const currentMembers = card.members ?? [];
  const removeSet = new Set(uniqueEmails);
  const newMembers = currentMembers.filter((m) => !removeSet.has(m.email.toLowerCase()));

  if (newMembers.length === currentMembers.length) {
    throw new Error('Nenhum dos emails indicados é membro do cartão');
  }

  return updateCardRaw(cardId, { members: newMembers });
}

export async function setCardArchived(cardId: number, archived: boolean): Promise<Card> {
  const card = await getCardDetails(cardId);
  if (card.archived === archived) {
    throw new Error(archived ? 'O cartão já está arquivado' : 'O cartão já não está arquivado');
  }
  return updateCardRaw(cardId, { archived });
}

export async function fetchAttachmentBinary(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
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

export async function listProjects(): Promise<Project[]> {
  const data = await request<{ projects: Project[] }>('GET', '/api/v1/projects');
  return data.projects;
}

export interface ProjectParticipant {
  email: string;
  name?: string;
  role?: string;
  permission?: string;
  status?: number;
  icon_url?: string;
  avatar?: string;
  icon?: string;
  user_icon?: string;
}

export async function getProjectCards(projectId: number): Promise<{
  columns: Column[];
  cards: Card[];
  participants?: ProjectParticipant[];
}> {
  const data = await request<{
    project_id: number;
    columns: Column[];
    cards: Card[];
    participants?: ProjectParticipant[];
  }>(
    'GET',
    `/api/v1/projects/${projectId}/cards`,
  );
  return { columns: data.columns, cards: data.cards, participants: data.participants };
}

function parseTrabalhoParticipants(project: {
  EmCarrege?: string;
  manager_name?: string;
  manager_icon?: string;
  Participantes?: ProjectParticipant[];
}): ProjectParticipant[] {
  const participants = project.Participantes ?? [];
  const managerEmail = project.EmCarrege;
  const list: ProjectParticipant[] = [];

  if (managerEmail) {
    list.push({
      email: managerEmail,
      name: project.manager_name || '',
      icon_url: project.manager_icon,
      role: 'manager',
      permission: 'write',
      status: 1,
    });
  }

  for (const participant of participants) {
    if (!participant.email) continue;
    if (managerEmail && participant.email.toLowerCase() === managerEmail.toLowerCase()) continue;
    list.push(participant);
  }

  return list;
}

/** Participantes do projeto com icon_url — igual ao DetalhesTrabDev.jsx */
export async function getProjectParticipantsEnriched(projectId: number): Promise<ProjectParticipant[]> {
  try {
    const { participants } = await getProjectCards(projectId);
    if (participants?.length) return participants;
  } catch {
    // fallback para endpoint legacy
  }

  const project = await requestGetFirst<{
    EmCarrege?: string;
    manager_name?: string;
    manager_icon?: string;
    Participantes?: ProjectParticipant[];
  }>([
    `/api/trabalhos/${projectId}`,
    `/server-api/api/trabalhos/${projectId}`,
  ]);

  return parseTrabalhoParticipants(project);
}

function normalizeCard(card: Card & { trabalhoId?: number }): Card {
  return {
    ...card,
    members: card.members ?? [],
    checklists: card.checklists ?? [],
    project_id: card.project_id ?? card.trabalhoId,
  };
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

export async function ensureCardProjectId(card: Card): Promise<Card> {
  if (card.project_id) return card;

  const projects = await listProjects();
  for (const project of projects) {
    const { cards } = await getProjectCards(project.id);
    if (cards.some((c) => c.id === card.id)) {
      return { ...card, project_id: project.id };
    }
  }
  return card;
}

export async function getCardDetails(cardId: number): Promise<Card> {
  try {
    const card = normalizeCard(await requestGetFirst<Card & { trabalhoId?: number }>([
      `/api/tarefas/${cardId}`,
      `/server-api/api/tarefas/${cardId}`,
      `/api/v1/cards/${cardId}`,
    ]));
    return ensureCardProjectId(card);
  } catch {
    const projects = await listProjects();
    for (const project of projects) {
      const { cards } = await getProjectCards(project.id);
      const card = cards.find((c) => c.id === cardId);
      if (card) return { ...card, project_id: card.project_id ?? project.id };
    }
    throw new Error(`Card ${cardId} não encontrado.`);
  }
}

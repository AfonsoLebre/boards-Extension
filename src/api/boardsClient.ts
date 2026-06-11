import * as vscode from 'vscode';

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

export interface CardMember {
  email: string;
  name: string;
}

export interface CardLabel {
  text: string;
  color: string;
}

export interface CardDescription {
  id: number;
  title: string;
  content: string;
}

export interface Card {
  id: number;
  title: string;
  description?: string;
  descriptions?: CardDescription[];
  status: string;
  status_label: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  start_date?: string;
  due_date?: string;
  members: CardMember[];
  labels: CardLabel[];
  order?: number;
}

export interface ProjectCardsResponse {
  project_id: number;
  columns: Column[];
  cards: Card[];
}

export interface CreateCardPayload {
  title: string;
  descriptions?: { id: number; title: string; content: string }[];
  columnId?: string;
  priority?: Card['priority'];
  labels?: string[];
  due_date?: string;
  members?: string[];
}

export interface UpdateCardPayload {
  title?: string;
  description?: string;
  columnId?: string;
  priority?: Card['priority'];
  due_date?: string;
}

export interface LinkCommitResponse {
  success: boolean;
  card_id: number;
  commit_hash: string;
}

export interface Comment {
  id: number;
  task_id: string;
  user_email: string;
  user_name: string;
  type: string;
  content: string;
  created_at: string;
}

export class BoardsApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BoardsApiError';
  }
}

export class BoardsClient {
  private get config() {
    return vscode.workspace.getConfiguration('anturio');
  }

  private get serverUrl(): string {
    return this.config.get<string>('serverUrl', 'http://localhost:3000').replace(/\/$/, '');
  }

  private get apiKey(): string {
    return this.config.get<string>('apiKey', '');
  }

  isConfigured(): boolean {
    return this.serverUrl.length > 0 && this.apiKey.length > 0;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.isConfigured()) {
      throw new BoardsApiError(401, 'API Key não configurada. Abre as definições do Anturio.');
    }

    const url = `${this.serverUrl}${path}`;
    console.log(`[BoardsClient] 🔵 ${method} ${url}`);
    if (body) console.log(`[BoardsClient] 📤 Body:`, JSON.stringify(body));

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'User-Agent': 'anturio-vscode/0.1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    console.log(`[BoardsClient] 📥 Status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      console.error(`[BoardsClient] ❌ Erro ${response.status}: ${text}`);
      throw new BoardsApiError(response.status, text);
    }

    const json = await response.json();
    console.log(`[BoardsClient] 📥 Response:`, JSON.stringify(json));
    return json as Promise<T>;
  }

  async getProjects(): Promise<Project[]> {
    const data = await this.request<{ projects: Project[] }>('GET', '/api/v1/projects');
    return data.projects;
  }

  async getProjectCards(projectId: number): Promise<ProjectCardsResponse> {
    return this.request<ProjectCardsResponse>('GET', `/api/v1/projects/${projectId}/cards`);
  }

  async createCard(projectId: number, payload: CreateCardPayload): Promise<Card> {
    return this.request<Card>('POST', `/api/v1/projects/${projectId}/cards`, payload);
  }

  async updateCard(cardId: number, payload: UpdateCardPayload): Promise<Card> {
    return this.request<Card>('PATCH', `/api/v1/cards/${cardId}`, payload);
  }

  async batchUpdateCards(updates: { id: number; status?: string; order?: number }[]): Promise<void> {
    await this.request<void>('POST', '/api/tarefas/batch-update', { updates });
  }

  async linkCommitToCard(cardId: number, commitHash: string): Promise<LinkCommitResponse> {
    return this.request<LinkCommitResponse>('POST', `/api/v1/cards/${cardId}/commits`, { commitHash });
  }

  async deleteCard(cardId: number): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/cards/${cardId}`);
  }

  async getComments(cardId: number): Promise<Comment[]> {
    return this.request<Comment[]>('GET', `/server-api/api/tarefas/${cardId}/activities`);
  }

  async addComment(cardId: number, content: string): Promise<Comment> {
    return this.request<Comment>('POST', '/server-api/api/activities', {
      task_id: cardId.toString(),
      type: 'comment',
      content,
    });
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/api/v1/projects');
      return true;
    } catch {
      return false;
    }
  }
}

export const boardsClient = new BoardsClient();

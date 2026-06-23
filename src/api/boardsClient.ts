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
  avatar?: string;
  icon?: string;
  icon_url?: string;
  user_icon?: string;
}

export interface CardLabel {
  text: string;
  color: string;
}

export interface CardDescription {
  id?: number;
  title: string;
  content: string;
}

export interface CardAttachment {
  name: string;
  url: string;
  type: string;
}

export interface ChecklistItemMember {
  email: string;
  name: string;
  icon_url?: string;
}

export interface ChecklistItem {
  text: string;
  completed?: boolean;
  checked?: boolean; // for backwards compatibility
  assignedMembers?: ChecklistItemMember[];
}

export interface Checklist {
  title: string;
  items: ChecklistItem[];
}

export interface Card {
  id: number;
  title: string;
  description?: string;
  descriptions?: CardDescription[];
  status: string;
  status_label: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  start_date?: string;
  due_date?: string;
  members: CardMember[];
  labels: CardLabel[];
  order?: number;
  creator_email?: string;
  attachments?: CardAttachment[];
  project_id?: number;
  checklists?: Checklist[];
}

export interface ProjectCardsResponse {
  project_id: number;
  columns: Column[];
  cards: Card[];
  participants?: ProjectParticipant[];
}

export interface ProjectParticipant {
  email: string;
  name?: string;
  role?: string;
  permission?: string;
  status?: number;
  icon_url?: string;
}

export interface CreateCardPayload {
  title: string;
  description?: string;
  descriptions?: { id?: number; title: string; content: string }[];
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
  due_date?: string | null;
  start_date?: string | null;
  user_email?: string;
  labels?: string[] | null;
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
  user_icon?: string;
  type: string;
  content: string;
  created_at: string;
  parent_id?: number | null;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export class BoardsApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BoardsApiError';
  }
}

export class BoardsClient {
  private _currentUser: CurrentUser | null = null;

  private get config() {
    return vscode.workspace.getConfiguration('anturio');
  }

  private get serverUrl(): string {
    let url = this.config.get<string>('serverUrl', 'https://boards.anturio.app').replace(/\/$/, '');
    if (url.endsWith('/api')) {
      url = url.substring(0, url.length - 4);
    }
    return url;
  }

  private get apiKey(): string {
    return this.config.get<string>('apiKey', '');
  }

  isConfigured(): boolean {
    return this.serverUrl.length > 0 && this.apiKey.length > 0;
  }

  async getCurrentUserEmail(): Promise<string | null> {
    if (!this._currentUser) {
      try {
        this._currentUser = await this.getCurrentUser();
      } catch {
        return null;
      }
    }
    return this._currentUser?.email ?? null;
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

  async getProjectLabels(projectId: number): Promise<{ text: string; color: string }[]> {
    try {
      // Get labels from global_labels endpoint
      const data = await this.request<{ text: string; color: string }[]>('GET', `/api/v1/global-labels?project_id=${projectId}`);
      if (data && data.length > 0) {
        return data;
      }
    } catch {
      // Continue to fallback
    }
    // Fallback: get unique labels from all cards in the project
    const projectData = await this.getProjectCards(projectId);
    const labelMap = new Map<string, string>();
    for (const card of projectData.cards) {
      for (const label of card.labels) {
        labelMap.set(label.text, label.color);
      }
    }
    return Array.from(labelMap.entries()).map(([text, color]) => ({ text, color }));
  }

  async getCard(cardId: number): Promise<Card> {
    return this.request<Card>('GET', `/api/v1/cards/${cardId}`);
  }

  async createCard(projectId: number, payload: CreateCardPayload): Promise<Card> {
    return this.request<Card>('POST', `/api/v1/projects/${projectId}/cards`, payload);
  }

  async updateCard(cardId: number, payload: UpdateCardPayload): Promise<Card> {
    return this.request<Card>('PATCH', `/api/v1/cards/${cardId}`, payload);
  }

  async updateCardRaw(cardId: number, payload: Partial<Card> & Record<string, any>): Promise<Card> {
    return this.request<Card>('PUT', `/server-api/api/tarefas/${cardId}`, payload);
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

  async getCardDetails(cardId: number): Promise<Card> {
    return this.request<Card>('GET', `/server-api/api/tarefas/${cardId}`);
  }

  async getComments(cardId: number): Promise<Comment[]> {
    console.log('[BoardsClient] getComments for card:', cardId);
    return this.request<Comment[]>('GET', `/server-api/api/tarefas/${cardId}/activities`);
  }

  async addComment(cardId: number, content: string, parentId?: number): Promise<Comment> {
    console.log('[BoardsClient] addComment parentId:', parentId, 'type:', typeof parentId);
    return this.request<Comment>('POST', '/server-api/api/activities', {
      task_id: cardId.toString(),
      type: 'comment',
      content,
      parent_id: parentId || null,
    });
  }

  async deleteComment(commentId: number): Promise<void> {
    await this.request<void>('DELETE', `/server-api/api/activities/${commentId}`);
  }

  async getCurrentUser(): Promise<CurrentUser> {
    return this.request<CurrentUser>('GET', '/api/v1/me');
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

import * as vscode from 'vscode';
import { boardsClient, Project, Column, Card } from '../api/boardsClient';

type ItemType = 'project' | 'column' | 'card' | 'card-detail' | 'empty' | 'error';

export class AnturioTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: ItemType,
    public readonly data?: Project | Column | Card,
    public readonly projectId?: number,
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.applyStyle();
  }

  private applyStyle() {
    switch (this.itemType) {
      case 'project':
        this.iconPath = new vscode.ThemeIcon('project');
        this.description = (this.data as Project)?.workspace_name;
        break;
      case 'column':
        this.iconPath = new vscode.ThemeIcon('list-unordered');
        break;
      case 'card': {
        const card = this.data as Card;
        this.iconPath = undefined;
        this.description = card.due_date
          ? `até ${new Date(card.due_date).toLocaleDateString('pt-PT')}`
          : undefined;
        break;
      }
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('dash');
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error');
        break;
      case 'card-detail':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }

  private priorityIcon(priority: string): string {
    switch (priority) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      case 'normal': return 'tasklist';
      default: return 'circle-outline';
    }
  }
}

// Global to store drag data between handleDrag and handleDrop
let draggingCardData: { cardId: number; projectId: number } | null = null;

export class BoardsProvider implements vscode.TreeDataProvider<AnturioTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnturioTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projectsCache: Project[] = [];
  private projectDataCache = new Map<number, { columns: Column[]; cards: Card[] }>();

  refresh(): void {
    this.projectsCache = [];
    this.projectDataCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnturioTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnturioTreeItem): Promise<AnturioTreeItem[]> {
    if (!boardsClient.isConfigured()) return [];

    if (!element) return this.loadProjects();
    if (element.itemType === 'project') return this.loadColumns(element.data as Project);
    if (element.itemType === 'column') return this.loadCards(element.data as Column, element.projectId!);
    if (element.itemType === 'card') return this.loadCardDetails(element.data as Card);
    return [];
  }

  // Drag & Drop support
  readonly dragAndDropController: vscode.TreeDragAndDropController<AnturioTreeItem> = {
    dragMimeTypes: ['application/vnd.code.tree.anturio-card'],
    dropMimeTypes: ['application/vnd.code.tree.anturio-card'],

    handleDrag: (source: readonly AnturioTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) => {
      if (source.length === 0 || source[0].itemType !== 'card') return;
      const card = source[0].data as Card;
      const projectId = source[0].projectId!;
      draggingCardData = { cardId: card.id, projectId };
    },

    handleDrop: async (target: AnturioTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) => {
      if (!target || !draggingCardData) return;
      if (target.itemType !== 'column' && target.itemType !== 'card') return;

      const projectId = target.projectId || draggingCardData.projectId;
      const projectData = this.projectDataCache.get(projectId);
      if (!projectData) return;

      const sourceCard = projectData.cards.find(c => c.id === draggingCardData!.cardId);
      if (!sourceCard) return;

      let targetColumnId: string;
      let targetCard: Card | undefined;

      if (target.itemType === 'column') {
        targetColumnId = (target.data as Column).id;
        targetCard = undefined;
      } else {
        targetCard = target.data as Card;
        targetColumnId = targetCard.status;
      }

      // Se é um cartão, não pode ser sobre si mesmo
      if (targetCard && targetCard.id === sourceCard.id) return;

      // Obter todos os cartões da coluna destino, ordenados
      const colCards = projectData.cards
        .filter(c => c.status === targetColumnId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      // Remover o cartão de origem se estiver na mesma coluna
      const otherCards = colCards.filter(c => c.id !== sourceCard.id);

      if (targetCard) {
        // Inserir DEPOIS do cartão alvo
        const targetIndex = otherCards.findIndex(c => c.id === targetCard!.id);
        otherCards.splice(targetIndex + 1, 0, sourceCard);
      } else {
        // É numa coluna vazia - adicionar no início
        otherCards.unshift(sourceCard);
      }

      // Se mudou de coluna, atualizar status do sourceCard
      if (sourceCard.status !== targetColumnId) {
        sourceCard.status = targetColumnId;
      }

      try {
        const updates = otherCards.map((c, index) => ({
          id: c.id,
          status: c.status,
          order: index,
        }));

        await boardsClient.batchUpdateCards(updates);
        vscode.commands.executeCommand('anturio.refresh');
        vscode.window.showInformationMessage('Cartão movido');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro';
        vscode.window.showErrorMessage(`Erro ao mover card: ${msg}`);
      }
      draggingCardData = null;
    },
  };

  private async loadProjects(): Promise<AnturioTreeItem[]> {
    try {
      this.projectsCache = await boardsClient.getProjects();

      if (this.projectsCache.length === 0) {
        return [new AnturioTreeItem('Sem projetos', vscode.TreeItemCollapsibleState.None, 'empty')];
      }

      return this.projectsCache.map(
        (p) => new AnturioTreeItem(p.title, vscode.TreeItemCollapsibleState.Collapsed, 'project', p),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      return [new AnturioTreeItem(`Erro: ${msg}`, vscode.TreeItemCollapsibleState.None, 'error')];
    }
  }

  private async loadColumns(project: Project): Promise<AnturioTreeItem[]> {
    await this.ensureProjectData(project.id);
    const cached = this.projectDataCache.get(project.id);
    if (!cached) return [];

    return cached.columns.map(
      (col) =>
        new AnturioTreeItem(
          col.title,
          vscode.TreeItemCollapsibleState.Collapsed,
          'column',
          col,
          project.id,
        ),
    );
  }

  private async loadCards(column: Column, projectId: number): Promise<AnturioTreeItem[]> {
    await this.ensureProjectData(projectId);
    const cached = this.projectDataCache.get(projectId);
    if (!cached) return [];

    const cards = cached.cards.filter((c) => c.status === column.id);

    if (cards.length === 0) {
      return [new AnturioTreeItem('Sem cards', vscode.TreeItemCollapsibleState.None, 'empty')];
    }

    return cards.map((card) => {
      const priorityEmoji = { critical: '🔴', high: '🟠', normal: '🟢', low: '🔵' }[card.priority || 'low'];
      const item = new AnturioTreeItem(
        `${priorityEmoji} ${card.title}`,
        vscode.TreeItemCollapsibleState.None,
        'card',
        card,
        projectId,
      );
      item.command = { command: 'anturio.openCard', title: 'Abrir Card', arguments: [card] };
      return item;
    });
  }

  async loadCardDetails(card: Card): Promise<AnturioTreeItem[]> {
    const details: AnturioTreeItem[] = [];

    // Descrição
    if (card.description) {
      details.push(new AnturioTreeItem(
        `📝 ${card.description.substring(0, 50)}${card.description.length > 50 ? '...' : ''}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    // Labels
    if (card.labels && card.labels.length > 0) {
      details.push(new AnturioTreeItem(
        `🏷️ ${card.labels.map(l => l.text).join(', ')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    // Data início
    if (card.start_date) {
      details.push(new AnturioTreeItem(
        `📅 Início: ${new Date(card.start_date).toLocaleDateString('pt-PT')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    // Data limite
    if (card.due_date) {
      details.push(new AnturioTreeItem(
        `⏰ Prazo: ${new Date(card.due_date).toLocaleDateString('pt-PT')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    // Membros
    if (card.members && card.members.length > 0) {
      details.push(new AnturioTreeItem(
        `👤 ${card.members.map(m => m.name || m.email).join(', ')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    if (details.length === 0) {
      details.push(new AnturioTreeItem(
        'Clique para ver detalhes completos',
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        card.project_id,
      ));
    }

    return details;
  }

  private async ensureProjectData(projectId: number): Promise<void> {
    if (this.projectDataCache.has(projectId)) return;
    try {
      const data = await boardsClient.getProjectCards(projectId);
      this.projectDataCache.set(projectId, { columns: data.columns, cards: data.cards });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro';
      vscode.window.showErrorMessage(`Erro ao carregar projeto: ${msg}`);
    }
  }

  getProjects(): Project[] {
    return this.projectsCache;
  }

  getProjectData(projectId: number): { columns: Column[]; cards: Card[] } | undefined {
    return this.projectDataCache.get(projectId);
  }
}

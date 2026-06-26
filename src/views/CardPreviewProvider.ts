import * as vscode from 'vscode';
import { Card, boardsClient } from '../api/boardsClient';

export class CardPreviewProvider implements vscode.TreeDataProvider<AnturioTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnturioTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeCard: Card | null = null;

  setActiveCard(card: Card | null): void {
    console.log('[CardPreviewProvider] setActiveCard:', card?.id, card?.title);
    this.activeCard = card;
    this._onDidChangeTreeData.fire();
  }

  getActiveCard(): Card | null {
    return this.activeCard;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnturioTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnturioTreeItem): Promise<AnturioTreeItem[]> {
    if (!this.activeCard) {
      return [new AnturioTreeItem(
        'Nenhum cartão aberto',
        vscode.TreeItemCollapsibleState.None,
        'empty'
      )];
    }

    // Root level - show all card details directly
    if (!element) {
      console.log('[CardPreviewProvider] getChildren root, activeCard:', this.activeCard?.id, this.activeCard?.title);
      return this.loadCardDetails(this.activeCard);
    }

    // For all other items, no children
    return [];
  }

  private async loadCardDetails(card: Card): Promise<AnturioTreeItem[]> {
    const details: AnturioTreeItem[] = [];
    const projectId = card.project_id;

    // Descrição completa (as clickable section)
    if (card.description) {
      details.push(new AnturioTreeItem(
        `📝 ${card.description.substring(0, 60)}${card.description.length > 60 ? '...' : ''}`,
        vscode.TreeItemCollapsibleState.None,
        'detail-section',
        card,
        projectId,
      ));
    }

    // Labels
    if (card.labels && card.labels.length > 0) {
      details.push(new AnturioTreeItem(
        `🏷️ Labels: ${card.labels.map(l => l.text).join(', ')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        projectId,
      ));
    }

    // Data início
    if (card.start_date) {
      details.push(new AnturioTreeItem(
        `📅 Início: ${new Date(card.start_date).toLocaleDateString('pt-PT')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        projectId,
      ));
    }

    // Data limite
    if (card.due_date) {
      details.push(new AnturioTreeItem(
        `⏰ Prazo: ${new Date(card.due_date).toLocaleDateString('pt-PT')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        projectId,
      ));
    }

    // Membros
    if (card.members && card.members.length > 0) {
      details.push(new AnturioTreeItem(
        `👤 Membros: ${card.members.map(m => m.name || m.email).join(', ')}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        projectId,
      ));
    }

    // Checklists
    if (card.checklists && card.checklists.length > 0) {
      for (const cl of card.checklists) {
        const checked = cl.items?.filter(i => i.completed || i.checked).length || 0;
        const total = cl.items?.length || 0;
        details.push(new AnturioTreeItem(
          `✅ Checklist: ${cl.title} (${checked}/${total})`,
          vscode.TreeItemCollapsibleState.None,
          'card-detail',
          card,
          projectId,
        ));
      }
    }

    // Anexos
    if (card.attachments && card.attachments.length > 0) {
      details.push(new AnturioTreeItem(
        `📎 Anexos: ${card.attachments.length}`,
        vscode.TreeItemCollapsibleState.None,
        'card-detail',
        card,
        projectId,
      ));
    }

    if (details.length === 0) {
      details.push(new AnturioTreeItem(
        'Sem detalhes disponíveis',
        vscode.TreeItemCollapsibleState.None,
        'empty',
        card,
        projectId,
      ));
    }

    return details;
  }
}

export class AnturioTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: string,
    public readonly data?: Card,
    public readonly projectId?: number,
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.applyStyle();
  }

  private applyStyle() {
    switch (this.itemType) {
      case 'card-header':
        this.iconPath = new vscode.ThemeIcon('tasklist');
        break;
      case 'card-detail':
      case 'detail-section':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
      case 'detail-text':
        this.iconPath = new vscode.ThemeIcon('note');
        break;
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('dash');
        break;
    }
  }
}
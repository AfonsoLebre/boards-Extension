import * as vscode from 'vscode';
import { Card, Comment, CurrentUser, boardsClient, CardAttachment, ProjectParticipant } from '../api/boardsClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';


const PRIORITY_LABELS: Record<string, string> = {
  critical: '🔴 Crítica',
  high: '🟠 Alta',
  normal: '🟢 Normal',
  low: '🔵 Baixa',
};

export class CardDetailPanel {
  private static panels = new Map<number, CardDetailPanel>();
  private readonly panel: vscode.WebviewPanel;
  private card!: Card;
  private currentUser: CurrentUser | null = null;
  private projectParticipants: ProjectParticipant[] = [];

  private constructor(card: Card) {
    this.card = card; // Inicializar logo para fallback
    this.panel = vscode.window.createWebviewPanel(
      'anturio.cardDetail',
      card.title,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    // Carregar detalhes completos do cartão para ter membros com fotos (com fallback)
    this.loadCardDetails(card.id, card);
    this.panel.onDidDispose(() => CardDetailPanel.panels.delete(card.id));
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private async loadCardDetails(cardId: number, fallbackCard?: Card): Promise<void> {
    try {
      // Buscar utilizador atual
      try {
        this.currentUser = await boardsClient.getCurrentUser();
      } catch (e) {
        console.log('[CardDetailPanel] Não foi possível obter utilizador atual:', e);
        this.currentUser = null;
      }
      // Buscar detalhes completos do cartão (inclui membros com fotos)
      const fullCard = await boardsClient.getCardDetails(cardId);
      this.card = fullCard;
      this.panel.title = fullCard.title;

      // Buscar participantes do projeto se temos project_id
      if (fullCard.project_id) {
        try {
          const projectData = await boardsClient.getProjectCards(fullCard.project_id);
          this.projectParticipants = projectData.participants || [];
        } catch (e) {
          console.log('[CardDetailPanel] Não foi possível obter participantes:', e);
          this.projectParticipants = [];
        }
      }

      const activities = await boardsClient.getComments(cardId);
      this.panel.webview.html = this.buildHtml(fullCard, activities, this.projectParticipants);
    } catch (err) {
      console.error('[CardDetailPanel] Erro ao carregar detalhes, a usar fallback:', err);
      // Fallback para o cartão original se falhar
      if (fallbackCard) {
        this.card = fallbackCard;
        this.panel.title = fallbackCard.title;
        // Buscar utilizador atual mesmo no fallback
        try {
          this.currentUser = await boardsClient.getCurrentUser();
        } catch (e) {
          console.log('[CardDetailPanel] Não foi possível obter utilizador atual no fallback:', e);
          this.currentUser = null;
        }
        try {
          const activities = await boardsClient.getComments(cardId);
          this.panel.webview.html = this.buildHtml(fallbackCard, activities, this.projectParticipants);
        } catch (e2) {
          console.error('[CardDetailPanel] Erro ao carregar comentários no fallback:', e2);
          // Mostrar mesmo sem comentários se falhar
          this.panel.webview.html = this.buildHtml(fallbackCard, [], this.projectParticipants);
        }
      }
    }
  }

  private async handleMessage(msg: { command: string; cardId?: number; title?: string; content?: string; index?: number; files?: any[]; commentId?: number; parentId?: number; email?: string; checklistIndex?: number; itemIndex?: number; text?: string; checked?: boolean }): Promise<void> {
    console.log('[handleMessage] command:', msg.command);
    if (msg.command === 'refreshComments' && this.card?.id) {
      console.log('[handleMessage] refreshing comments for card:', this.card.id);
      await this.loadComments(this.card.id);
    } else if (msg.command === 'updateCardTitle' && msg.cardId && msg.title) {
      try {
        console.log('[CardDetailPanel] Updating title for card:', msg.cardId);
        const updated = await boardsClient.updateCard(msg.cardId, { title: msg.title });
        this.card.title = updated.title;
        this.panel.title = updated.title;
        this.panel.webview.postMessage({ command: 'updateCardTitleSuccess', title: updated.title });
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao actualizar título:', err);
      }
    } else if (msg.command === 'addComment' && msg.cardId && msg.content) {
      try {
        console.log('[CardDetailPanel] Adding comment to card:', msg.cardId, 'content:', msg.content, 'parentId:', msg.parentId);
        const comment = await boardsClient.addComment(msg.cardId, msg.content, msg.parentId);
        console.log('[CardDetailPanel] Comment added:', comment);
        this.panel.webview.postMessage({ command: 'commentAdded', comment });
        this.loadCardDetails(this.card.id);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar comentário:', err);
        this.panel.webview.postMessage({ command: 'commentError', error: err instanceof Error ? err.message : String(err) });
      }
    } else if (msg.command === 'deleteComment' && msg.commentId) {
      try {
        console.log('[CardDetailPanel] Deleting comment:', msg.commentId);
        await boardsClient.deleteComment(msg.commentId);
        this.panel.webview.postMessage({ command: 'commentDeleted' });
        this.loadCardDetails(this.card.id);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao eliminar comentário:', err);
        this.panel.webview.postMessage({ command: 'commentDeleteError', error: err instanceof Error ? err.message : String(err) });
      }
    } else if (msg.command === 'addAttachments' && msg.cardId && msg.files) {
      try {
        const files: CardAttachment[] = msg.files;
        console.log('[CardDetailPanel] Adding attachments to card:', msg.cardId, 'files count:', files.length);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const currentAttachments = fullCard.attachments || [];
        const newAttachments = [...currentAttachments, ...files];
        await boardsClient.updateCardRaw(msg.cardId, {
          attachments: newAttachments,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar anexos:', err);
        vscode.window.showErrorMessage('Erro ao adicionar anexos: ' + (err instanceof Error ? err.message : String(err)));
        this.panel.webview.postMessage({ command: 'attachmentError' });
      }
    } else if (msg.command === 'deleteAttachment' && msg.cardId && msg.index !== undefined) {
      try {
        const index = msg.index;
        console.log('[CardDetailPanel] Deleting attachment from card:', msg.cardId, 'index:', index);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const currentAttachments = fullCard.attachments || [];
        const newAttachments = currentAttachments.filter((_, i) => i !== index);
        await boardsClient.updateCardRaw(msg.cardId, {
          attachments: newAttachments,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao eliminar anexo:', err);
        vscode.window.showErrorMessage('Erro ao eliminar anexo: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'openAttachment' && msg.cardId && msg.index !== undefined) {
      try {
        const index = msg.index;
        console.log('[CardDetailPanel] Opening attachment index:', index);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const att = (fullCard.attachments || [])[index];
        if (!att) throw new Error('Anexo não encontrado');

        if (att.url.startsWith('data:')) {
          const parts = att.url.split(',');
          const base64Data = parts[1];
          const buffer = Buffer.from(base64Data, 'base64');
          // Sanitizar o nome do ficheiro para evitar problemas no path
          const safeName = att.name.replace(/[<>:"/\\|?*]/g, '_');
          const tempFilePath = path.join(os.tmpdir(), safeName);
          fs.writeFileSync(tempFilePath, buffer);
          console.log('[CardDetailPanel] Temp file written:', tempFilePath);
          // Abrir com a aplicação padrão do SO (mais fiável que vscode.env.openExternal para ficheiros locais)
          if (process.platform === 'win32') {
            cp.exec(`start "" "${tempFilePath}"`);
          } else if (process.platform === 'darwin') {
            cp.exec(`open "${tempFilePath}"`);
          } else {
            cp.exec(`xdg-open "${tempFilePath}"`);
          }
        } else {
          // URL externo — abrir no browser
          vscode.env.openExternal(vscode.Uri.parse(att.url));
        }
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao abrir anexo:', err);
        vscode.window.showErrorMessage('Erro ao abrir anexo: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'addMember' && msg.cardId && msg.email) {
      try {
        console.log('[CardDetailPanel] Adding member to card:', msg.cardId, 'email:', msg.email);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const currentMembers = fullCard.members || [];
        // Verificar se já é membro
        if (currentMembers.some((m) => m.email?.toLowerCase() === msg.email?.toLowerCase())) {
          vscode.window.showWarningMessage('Este utilizador já é membro do cartão');
          return;
        }
        // Obter dados do participante para adicionar
        const participant = this.projectParticipants.find((p) => p.email?.toLowerCase() === msg.email?.toLowerCase());
        const newMember = {
          email: msg.email,
          name: participant?.name || '',
          icon_url: participant?.icon_url || '',
        };
        const newMembers = [...currentMembers, newMember];
        await boardsClient.updateCardRaw(msg.cardId, {
          members: newMembers,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.panel.webview.postMessage({ command: 'memberAdded', email: msg.email });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar membro:', err);
        vscode.window.showErrorMessage('Erro ao adicionar membro: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'removeMember' && msg.cardId && msg.email) {
      try {
        console.log('[CardDetailPanel] Removing member from card:', msg.cardId, 'email:', msg.email);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const currentMembers = fullCard.members || [];
        const newMembers = currentMembers.filter((m) => m.email?.toLowerCase() !== msg.email?.toLowerCase());
        await boardsClient.updateCardRaw(msg.cardId, {
          members: newMembers,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.panel.webview.postMessage({ command: 'memberRemoved', email: msg.email });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao remover membro:', err);
        vscode.window.showErrorMessage('Erro ao remover membro: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'addChecklist' && msg.cardId && msg.title) {
      try {
        console.log('[CardDetailPanel] Adding checklist:', msg.cardId, 'title:', msg.title);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        checklists.push({ title: msg.title, items: [] });
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar checklist:', err);
        vscode.window.showErrorMessage('Erro ao adicionar checklist: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'addDescription' && msg.cardId && msg.title) {
      try {
        console.log('[CardDetailPanel] Adding description:', msg.cardId, 'title:', msg.title);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const descriptions = fullCard.descriptions || [];
        // Don't save placeholder text - treat as empty
        const placeholderText = 'Duplo clique para editar...';
        const content = msg.content && msg.content !== placeholderText ? msg.content : '';
        descriptions.push({ title: msg.title, content: content });
        await boardsClient.updateCardRaw(msg.cardId, {
          descriptions,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar descrição:', err);
        vscode.window.showErrorMessage('Erro ao adicionar descrição: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'updateDescription' && msg.cardId && msg.index !== undefined && msg.title !== undefined) {
      try {
        console.log('[CardDetailPanel] Updating description:', msg.cardId, 'index:', msg.index, 'title:', msg.title, 'content:', msg.content);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const descriptions = fullCard.descriptions || [];
        if (!descriptions[msg.index]) throw new Error('Descrição não encontrada');
        descriptions[msg.index] = { ...descriptions[msg.index], title: msg.title, content: msg.content };
        await boardsClient.updateCardRaw(msg.cardId, {
          descriptions,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao actualizar descrição:', err);
        vscode.window.showErrorMessage('Erro ao actualizar descrição: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'deleteDescription' && msg.cardId && msg.index !== undefined) {
      try {
        console.log('[CardDetailPanel] Deleting description:', msg.cardId, 'index:', msg.index, 'type:', typeof msg.index);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        console.log('[CardDetailPanel] Current descriptions:', fullCard.descriptions);
        const descriptions = fullCard.descriptions || [];
        if (msg.index < 0 || msg.index >= descriptions.length) {
          throw new Error('Índice inválido: ' + msg.index + ', total: ' + descriptions.length);
        }
        descriptions.splice(msg.index, 1);
        console.log('[CardDetailPanel] After splice, descriptions:', descriptions);
        await boardsClient.updateCardRaw(msg.cardId, {
          descriptions,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao eliminar descrição:', err);
        vscode.window.showErrorMessage('Erro ao eliminar descrição: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'addChecklistItem' && msg.cardId && msg.checklistIndex !== undefined && msg.text) {
      try {
        console.log('[CardDetailPanel] Adding checklist item:', msg.cardId, 'checklist:', msg.checklistIndex, 'text:', msg.text);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex]) throw new Error('Checklist não encontrado');
        checklists[msg.checklistIndex].items = checklists[msg.checklistIndex].items || [];
        checklists[msg.checklistIndex].items.push({ text: msg.text, checked: false, completed: false });
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao adicionar item:', err);
        vscode.window.showErrorMessage('Erro ao adicionar item: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'toggleChecklistItem' && msg.cardId && msg.checklistIndex !== undefined && msg.itemIndex !== undefined) {
      try {
        console.log('[CardDetailPanel] Toggling checklist item:', msg.cardId, 'checklist:', msg.checklistIndex, 'item:', msg.itemIndex, 'checked:', msg.checked);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex] || !checklists[msg.checklistIndex].items) throw new Error('Item não encontrado');
        checklists[msg.checklistIndex].items[msg.itemIndex].checked = msg.checked;
        checklists[msg.checklistIndex].items[msg.itemIndex].completed = msg.checked;
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao marcar item:', err);
        vscode.window.showErrorMessage('Erro ao atualizar item: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'deleteChecklistItem' && msg.cardId && msg.checklistIndex !== undefined && msg.itemIndex !== undefined) {
      try {
        console.log('[CardDetailPanel] Deleting checklist item:', msg.cardId, 'checklist:', msg.checklistIndex, 'item:', msg.itemIndex);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex] || !checklists[msg.checklistIndex].items) throw new Error('Item não encontrado');
        checklists[msg.checklistIndex].items.splice(msg.itemIndex, 1);
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao eliminar item:', err);
        vscode.window.showErrorMessage('Erro ao eliminar item: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'deleteChecklist' && msg.cardId && msg.checklistIndex !== undefined) {
      try {
        console.log('[CardDetailPanel] Deleting checklist:', msg.cardId, 'checklist:', msg.checklistIndex);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        checklists.splice(msg.checklistIndex, 1);
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao eliminar checklist:', err);
        vscode.window.showErrorMessage('Erro ao eliminar checklist: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'updateChecklistTitle' && msg.cardId && msg.checklistIndex !== undefined && msg.title !== undefined) {
      try {
        console.log('[CardDetailPanel] Updating checklist title:', msg.cardId, 'checklist:', msg.checklistIndex, 'title:', msg.title);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex]) throw new Error('Checklist não encontrado');
        checklists[msg.checklistIndex].title = msg.title;
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao atualizar título:', err);
        vscode.window.showErrorMessage('Erro ao atualizar título: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'updateChecklistItemText' && msg.cardId && msg.checklistIndex !== undefined && msg.itemIndex !== undefined && msg.text !== undefined) {
      try {
        console.log('[CardDetailPanel] Updating checklist item text:', msg.cardId, 'checklist:', msg.checklistIndex, 'item:', msg.itemIndex, 'text:', msg.text);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex] || !checklists[msg.checklistIndex].items[msg.itemIndex]) throw new Error('Item não encontrado');
        checklists[msg.checklistIndex].items[msg.itemIndex].text = msg.text;
        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao atualizar item:', err);
        vscode.window.showErrorMessage('Erro ao atualizar item: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'toggleChecklistItemMember' && msg.cardId && msg.checklistIndex !== undefined && msg.itemIndex !== undefined && msg.email) {
      try {
        console.log('[CardDetailPanel] Toggling checklist item member:', msg.cardId, 'checklist:', msg.checklistIndex, 'item:', msg.itemIndex, 'email:', msg.email);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex] || !checklists[msg.checklistIndex].items[msg.itemIndex]) throw new Error('Item não encontrado');

        const item = checklists[msg.checklistIndex].items[msg.itemIndex];
        const currentMembers = item.assignedMembers || [];
        const memberIndex = currentMembers.findIndex(m => m.email === msg.email);

        // Find participant details
        const participant = this.projectParticipants.find(p => p.email === msg.email);

        if (memberIndex >= 0) {
          // Remove member
          item.assignedMembers = currentMembers.filter(m => m.email !== msg.email);
        } else {
          // Add member
          item.assignedMembers = [...currentMembers, {
            email: msg.email,
            name: participant?.name || msg.email,
            icon_url: participant?.icon_url
          }];
        }

        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao atualizar membro do item:', err);
        vscode.window.showErrorMessage('Erro ao atualizar membro: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'removeChecklistItemMembers' && msg.cardId && msg.checklistIndex !== undefined && msg.itemIndex !== undefined) {
      try {
        console.log('[CardDetailPanel] Removing all checklist item members:', msg.cardId, 'checklist:', msg.checklistIndex, 'item:', msg.itemIndex);
        const fullCard = await boardsClient.getCardDetails(msg.cardId);
        const checklists = fullCard.checklists || [];
        if (!checklists[msg.checklistIndex] || !checklists[msg.checklistIndex].items[msg.itemIndex]) throw new Error('Item não encontrado');

        checklists[msg.checklistIndex].items[msg.itemIndex].assignedMembers = [];

        await boardsClient.updateCardRaw(msg.cardId, {
          checklists,
          user_email: this.currentUser?.email,
          user_name: this.currentUser?.name,
        });
        this.loadCardDetails(msg.cardId);
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao remover membros do item:', err);
        vscode.window.showErrorMessage('Erro ao remover membros: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (msg.command === 'getProjectParticipants' && msg.cardId) {
      try {
        console.log('[CardDetailPanel] Getting project participants for card:', msg.cardId);
        this.panel.webview.postMessage({
          command: 'projectParticipants',
          participants: this.projectParticipants
        });
      } catch (err) {
        console.error('[CardDetailPanel] Erro ao obter participantes:', err);
      }
    }
  }

  static show(card: Card): void {
    // Se já existe, revela o painel existente
    if (CardDetailPanel.panels.has(card.id)) {
      CardDetailPanel.panels.get(card.id)!.panel.reveal();
      return;
    }
    CardDetailPanel.panels.set(card.id, new CardDetailPanel(card));
  }

  private async loadComments(cardId: number): Promise<void> {
    try {
      const activities = await boardsClient.getComments(cardId);
      this.panel.webview.html = this.buildHtml(this.card, activities, this.projectParticipants);
    } catch (err) {
      console.error('Erro ao carregar comentários:', err);
    }
  }

  private getActivityIcon(type: string): string {
    const icons: Record<string, string> = {
      created: '📋',
      updated: '✏️',
      moved: '➡️',
      assigned: '👤',
      archived: '📦',
      checked: '✅',
      unchecked: '⬜',
      comment: '💬',
    };
    return icons[type] || '📌';
  }

  private buildHtml(card: Card, activities: Comment[], participants: ProjectParticipant[] = []): string {
    const labels = card.labels
      .map((l) => `<span class="label" style="background:${this.escape(l.color)}">${this.escape(l.text)}</span>`)
      .join('');

    // Mostrar membros como mini-avatar ao lado do título
    // Obter emails dos membros atuais do cartão
    const currentMemberEmails = new Set((card.members || []).map((m) => m.email?.toLowerCase()).filter(Boolean));

    // Obter participantes disponíveis que ainda não são membros
    const availableParticipants = (participants || []).filter((p) => !currentMemberEmails.has(p.email?.toLowerCase()));

    // membersAvatars com botão de remover para cada membro
    const membersAvatars = card.members.length > 0
      ? card.members.map((m) => {
        const initial = (m.name || m.email || "?").substring(0, 1).toUpperCase();
        const anyM = m as any;
        const memberIcon =
          m.avatar ||
          m.icon_url ||
          m.user_icon ||
          m.icon ||
          anyM.photo ||
          anyM.picture ||
          anyM.user_avatar ||
          anyM.avatar_url ||
          anyM.img || '';
        const avatarHtml = memberIcon
          ? `<img class="member-avatar member-img" src="${memberIcon}" alt="${this.escape(m.name)}" title="${this.escape(m.name)}">`
          : `<span class="member-avatar" title="${this.escape(m.name)}">${initial}</span>`;
        return `<div class="member-wrapper" data-email="${this.escape(m.email)}">${avatarHtml}<span class="member-remove" title="Remover membro" onclick="window.removeMember(event, '${this.escape(m.email)}')">×</span></div>`;
      }).join('')
      : '';

    // Botão de adicionar membros se houver participantes disponíveis
    const addMemberButton = availableParticipants.length > 0
      ? `<button class="add-member-btn" onclick="window.showAddMemberMenu(event)" title="Adicionar membro">+</button>`
      : '';

    const dates = (card.start_date || card.due_date)
      ? `<div class="dates">
          ${card.start_date ? `<span>Início: <b>${new Date(card.start_date).toLocaleDateString('pt-PT')}</b></span>` : ''}
          ${card.due_date ? `<span>Prazo: <b>${new Date(card.due_date).toLocaleDateString('pt-PT')}</b></span>` : ''}
        </div>`
      : '';

    // Obter todas as descrições do array descriptions ou do campo description simples
    const descriptionHtml = (() => {
      const descriptions: { title: string; content: string }[] = [];

      // Primeiro verificar se há descrições no array
      if (card.descriptions && card.descriptions.length > 0) {
        card.descriptions.forEach((d) => {
          // Incluir todas as descrições, incluindo as vazias (para novas descrições)
          if (d.content !== undefined) {
            descriptions.push({ title: d.title || 'Descrição', content: d.content || '' });
          }
        });
      }

      // Fallback para campo description simples se não houver descrições no array
      if (descriptions.length === 0 && card.description) {
        descriptions.push({ title: 'Descrição', content: card.description });
      }

      if (descriptions.length === 0) {
        // Se não há descrições, mostrar secção vazia com botão para adicionar
        return `
          <section>
            <h3><span class="section-toggle" onclick="window.toggleSection('descriptions-section')">▾</span> Descrições (${descriptions.length})</h3>
            <div class="descriptions-all" id="descriptions-section">
              <button class="description-add-button" onclick="window.addDescription()">+ Adicionar Descrição</button>
            </div>
          </section>
        `;
      }

      const descriptionsCount = descriptions.length;

      // Função para renderizar uma descrição
      const renderDescription = (d: { title: string; content: string; id?: number }, idx: number) => {
        const safeId = 'desc-' + idx;
        const showDeleteBtn = descriptionsCount > 1;
        return `
          <section class="description-section" data-desc-id="${d.id || ''}" data-desc-idx="${idx}">
            <h3>
              <span class="section-toggle" onclick="window.toggleSection('${safeId}')">▾</span>
              <span class="description-title-text" ondblclick="window.editDescriptionTitle(${idx})">${this.escape(d.title)}</span>
              <input type="text" class="description-title-input" id="description-title-edit-${idx}" value="${this.escape(d.title)}" style="display:none">
              ${showDeleteBtn ? `<button class="description-delete-btn" onclick="event.stopPropagation(); window.deleteDescription(${idx})" title="Eliminar descrição">🗑</button>` : ''}
            </h3>
            <div class="description-content" id="${safeId}">
              <div class="description-text" ondblclick="window.editDescriptionContent(${idx})" data-content-empty="${!d.content || !d.content.replace(/^\s+$/g, '')}">${d.content && d.content.replace(/^\s+|$/g, '') ? this.renderDescriptionWithImages(d.content) : '<em class="description-placeholder">Duplo clique para editar...</em>'}</div>
              <textarea class="description-textarea" id="description-edit-${idx}" style="display:none">${d.content && d.content.replace(/^\s+$/g, '') ? this.escape(d.content) : ''}</textarea>
              <div class="description-edit-hint" style="display:none">Enter para guardar | Esc para cancelar</div>
            </div>
          </section>
        `;
      };

      // Mostrar todas as descrições com os seus títulos
      const descriptionsHtml = descriptions.map((d, idx) => renderDescription(d, idx)).join('');

      // UI para adicionar nova descrição (apenas um botão)
      const addDescriptionHtml = `
        <button class="description-add-button" onclick="window.addDescription()">+ Adicionar Descrição</button>
      `;

      return `
        <section>
          <h3><span class="section-toggle" onclick="window.toggleSection('descriptions-section')">▾</span> Descrições (${descriptions.length})</h3>
          <div class="descriptions-all" id="descriptions-section">
            ${descriptionsHtml}
            ${addDescriptionHtml}
          </div>
        </section>
      `;
    })();

    const attachmentsHtml = (() => {
      const attachments = card.attachments || [];
      const listHtml = attachments.length > 0
        ? attachments.map((att, idx) => {
          const isImage = att.type?.startsWith('image/');
          let thumbContent = '';
          if (isImage) {
            thumbContent = `<img src="${att.url}" alt="" />`;
          } else {
            thumbContent = att.type?.includes('pdf') ? '📕' : '📄';
          }
          return `
              <div class="attachment-item">
                <div class="attachment-left" onclick="window.openAttachment(${idx})">
                  <div class="attachment-thumb">${thumbContent}</div>
                  <div class="attachment-info">
                    <span class="attachment-name">${this.escape(att.name)}</span>
                    <span class="attachment-type">${this.escape(att.type?.split('/')[1] || 'ficheiro')}</span>
                  </div>
                </div>
                <button class="attachment-delete-btn" title="Eliminar anexo" onclick="window.deleteAttachment(event, ${idx})">✕</button>
              </div>
            `;
        }).join('')
        : '<p class="meta" id="no-attachments-meta">Sem anexos ainda.</p>';

      return `
        <section>
          <h3><span class="section-toggle" onclick="window.toggleSection('attachments-list')">▾</span> Anexos (<span id="attachments-count">${attachments.length}</span>)</h3>
          <div class="attachments-list" id="attachments-list">
            ${listHtml}
            <div class="attachment-dropzone" id="attachment-dropzone">
              <div class="dropzone-content">
                <span class="dropzone-icon">📥</span>
                <span class="dropzone-text">Arraste ficheiros aqui para adicionar anexos</span>
              </div>
              <input type="file" id="attachment-input" style="display:none;" multiple>
            </div>
            <button id="add-attachment-btn" class="attachment-button">📎 Adicionar Anexo</button>
          </div>
        </section>
      `;
    })();

    // Checklists UI
    const checklistsHtml = (() => {
      const checklists = card.checklists || [];
      const listHtml = checklists.length > 0
        ? checklists.map((cl, idx) => {
          const itemsHtml = cl.items?.length > 0
            ? cl.items.map((item, itemIdx) => {
              const isChecked = item.completed || item.checked || false;
              const itemMembers = item.assignedMembers || [];
              const membersHtml = itemMembers.length > 0
                ? itemMembers.slice(0, 2).map((m, mIdx) => `
                    <div class="checklist-item-member-avatar" title="${this.escape(m.name || m.email)}" style="z-index: ${mIdx + 1}">
                      ${m.icon_url ? `<img src="${this.escape(m.icon_url)}" class="checklist-item-member-img">` : this.escape((m.name || m.email || '?').substring(0, 2).toUpperCase())}
                    </div>
                  `).join('') + (itemMembers.length > 2 ? `<div class="checklist-item-member-overflow">+${itemMembers.length - 2}</div>` : '')
                : '';
              return `
              <div class="checklist-item">
                <input type="checkbox" class="checklist-checkbox" ${isChecked ? 'checked' : ''} onchange="window.toggleChecklistItem(${idx}, ${itemIdx}, this.checked)">
                <span class="checklist-item-text ${isChecked ? 'checked' : ''}" ondblclick="window.editChecklistItemText(${idx}, ${itemIdx})">${this.escape(item.text)}</span>
                <input type="text" class="checklist-item-input" id="checklist-item-edit-${idx}-${itemIdx}" value="${this.escape(item.text)}" style="display:none">
                <div class="checklist-item-members">${membersHtml}</div>
                <button class="checklist-item-member-btn" onclick="window.toggleChecklistItemMemberMenu(${idx}, ${itemIdx})" title="Membros">👤</button>
                <div class="checklist-item-member-menu" id="checklist-item-member-menu-${idx}-${itemIdx}" style="display:none">
                  <div class="checklist-item-member-menu-header">Membros do Item</div>
                  <div class="checklist-item-member-menu-list">
                    <div class="checklist-item-member-option ${!itemMembers.length ? 'selected' : ''}" onclick="window.removeChecklistItemMember(${idx}, ${itemIdx}, null)">✕ Remover todos</div>
                    ${participants.map(p => `
                      <div class="checklist-item-member-option ${itemMembers.some(m => m.email === p.email) ? 'selected' : ''}" onclick="window.toggleChecklistItemMember(${idx}, ${itemIdx}, '${this.escape(p.email)}')">
                        ${p.icon_url ? `<img src="${this.escape(p.icon_url)}" class="checklist-item-member-option-img">` : this.escape((p.name || p.email || '?').substring(0, 2).toUpperCase())}
                        <span>${this.escape(p.name || p.email)}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
                <button class="checklist-item-delete" onclick="window.deleteChecklistItem(${idx}, ${itemIdx})" title="Eliminar">×</button>
              </div>
            `}).join('')
            : '<p class="meta">Sem itens.</p>';
          const checkedCount = cl.items?.filter((i) => i.completed || i.checked).length || 0;
          const totalCount = cl.items?.length || 0;
          const checklistId = 'checklist-' + idx;
          return `
            <div class="checklist-section">
              <div class="checklist-header">
                <span class="section-toggle" onclick="window.toggleSection('${checklistId}-content')">▾</span>
                <span class="checklist-title" ondblclick="window.editChecklistTitle(${idx})">${this.escape(cl.title)}</span>
                <input type="text" class="checklist-title-input" id="checklist-title-edit-${idx}" value="${this.escape(cl.title)}" style="display:none">
                <span class="checklist-progress">${checkedCount}/${totalCount}</span>
                <button class="checklist-delete-btn" onclick="window.deleteChecklist(${idx})" title="Eliminar checklist">🗑</button>
              </div>
              <div id="${checklistId}-content">
                <div class="checklist-items">${itemsHtml}</div>
                <div class="checklist-add-item">
                  <input type="text" class="checklist-new-item-input" placeholder="Novo item..." onkeypress="window.addChecklistItemKeypress(event, ${idx})">
                  <button class="checklist-add-item-btn" onclick="window.addChecklistItem(${idx})">+</button>
                </div>
              </div>
            </div>
          `;
        }).join('')
        : '';

      return `
        <section>
          <h3><span class="section-toggle" onclick="window.toggleSection('checklists-list')">▾</span> Checklists (<span id="checklists-count">${checklists.length}</span>)</h3>
          <div class="checklists-list" id="checklists-list">
            ${listHtml}
            <div class="checklist-add-section">
              <input type="text" id="checklist-title-input" class="checklist-title-input" placeholder="Título da nova checklist..." onkeypress="if(event.key==='Enter')window.addChecklist()">
              <button id="add-checklist-btn" class="checklist-button" onclick="window.addChecklist()">+ Criar Checklist</button>
            </div>
          </div>
        </section>
      `;
    })();

    const comments = activities
      .filter((a) => a.type === 'comment')
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (isNaN(timeA) || isNaN(timeB)) return a.id - b.id;
        return timeA !== timeB ? timeA - timeB : a.id - b.id;
      });

    const history = activities
      .filter((a) => a.type !== 'comment')
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (isNaN(timeA) || isNaN(timeB)) return a.id - b.id;
        return timeA !== timeB ? timeA - timeB : a.id - b.id;
      });

    const currentUserEmail = this.currentUser?.email?.toLowerCase();

    // Função para renderizar um comentário
    const renderComment = (c: Comment) => {
      const isReply = !!c.parent_id;
      const isOwnComment = currentUserEmail && c.user_email?.toLowerCase() === currentUserEmail;
      const commentClass = isOwnComment ? 'comment is-own-comment' : (isReply ? 'comment is-reply' : 'comment');
      
      // Para respostas, encontrar o comentário pai para mostrar a quem responde
      let replyToIndicator = '';
      let replyPreview = '';
      if (isReply && c.parent_id) {
        const parentComment = comments.find(p => p.id === c.parent_id);
        if (parentComment) {
          const parentName = parentComment.user_name || parentComment.user_email;
          const parentAvatarInitial = (parentComment.user_name || parentComment.user_email || "?").substring(0, 2).toUpperCase();
          const parentAvatarHtml = parentComment.user_icon
            ? `<img class="reply-to-avatar" src="${parentComment.user_icon}" alt="">`
            : `<span class="reply-to-avatar">${parentAvatarInitial}</span>`;
          const preview = parentComment.content.length > 60 ? parentComment.content.substring(0, 60) + '...' : parentComment.content;
          replyToIndicator = `<span class="reply-to-indicator">${parentAvatarHtml}<span>↩️ ${this.escape(parentName)}</span></span>`;
          replyPreview = `<div class="reply-preview">"${this.escape(preview)}"</div>`;
        }
      }

      const deleteBtn = isOwnComment ? `<button class="comment-delete-btn" onclick="window.deleteComment(event, ${c.id})" title="Eliminar comentário">✕</button>` : '';
      const replyBtn = `<button class="comment-reply-btn" data-comment-id="${c.id}" data-parent-id="${c.id}" title="Responder">↩️</button>`;
      const avatarInitial = (c.user_name || c.user_email || "?").substring(0, 2).toUpperCase();
      const avatarHtml = c.user_icon
        ? `<img class="comment-avatar" src="${c.user_icon}" alt="" title="${this.escape(c.user_name || c.user_email)}">`
        : `<span class="comment-avatar" title="${this.escape(c.user_name || c.user_email)}">${avatarInitial}</span>`;

      return `
        <div class="${commentClass}" data-comment-id="${c.id}">
          <div class="comment-header">
            ${avatarHtml}
            <div class="comment-header-info">
              <span class="comment-author">${this.escape(c.user_name || c.user_email)}</span>
              <span class="comment-date">${new Date(c.created_at).toLocaleString('pt-PT')}</span>
            </div>
            <div class="comment-header-actions">
              ${replyBtn}
              ${deleteBtn}
            </div>
          </div>
          ${replyToIndicator ? `<div class="reply-to-line">${replyToIndicator}</div>` : ''}
          <div class="comment-content">${this.renderHtml(c.content)}</div>
          ${replyPreview}
        </div>
      `;
    };

    const commentsHtml = `
      <section>
        <h3><span class="section-toggle" onclick="window.toggleSection('comments-list')">▾</span> Comentários (${comments.length})</h3>
        <div class="comments" id="comments-list">
          ${comments.length > 0
            ? comments.map((c) => renderComment(c)).join('')
            : '<p class="meta">Sem comentários ainda.</p>'}
          <div class="add-comment">
            <textarea id="new-comment" placeholder="Escreve um comentário..." rows="3"></textarea>
            <input type="hidden" id="reply-to-comment" value="">
            <button id="add-comment-btn" class="comment-button">Adicionar Comentário</button>
          </div>
        </div>
      </section>
    `;

    const historyHtml = history.length > 0
      ? `<section>
          <h3><span class="section-toggle" onclick="window.toggleSection('history-list')">▾</span> Histórico (${history.length})</h3>
          <div class="history" id="history-list">
            ${history.map((h) => {
        const isOwnHistory = currentUserEmail && h.user_email?.toLowerCase() === currentUserEmail;
        const historyItemClass = isOwnHistory ? 'history-item is-own-history' : 'history-item';
        const avatarInitial = (h.user_name || h.user_email || "?").substring(0, 2).toUpperCase();
        const avatarHtml = h.user_icon
          ? `<img class="history-avatar" src="${h.user_icon}" alt="" title="${this.escape(h.user_name || h.user_email)}">`
          : `<span class="history-avatar" title="${this.escape(h.user_name || h.user_email)}">${avatarInitial}</span>`;
        return `
                <div class="${historyItemClass}">
                  <div class="history-header">
                    ${avatarHtml}
                    <span class="history-icon">${this.getActivityIcon(h.type)}</span>
                    <span class="history-text">${this.escape(h.user_name || h.user_email)}</span>
                    <span class="history-date">${new Date(h.created_at).toLocaleString('pt-PT')}</span>
                  </div>
                  ${h.content ? `<div class="history-content">${this.renderHtml(h.content)}</div>` : ''}
                </div>
              `;
      }).join('')}
          </div>
        </section>`
      : '';

    return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="img-src * data: blob:; default-src * 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval';">
  <title>${this.escape(card.title)}</title>
  <style>
    * { text-align: left; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; line-height: 1.6; max-width: 600px; margin: 0; }
    h1 { font-size: 1.3em; margin-bottom: 6px; margin-left: 0; padding-left: 0; }
    h3 { font-size: 0.9em; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
    section { margin-top: 20px; border-top: 1px solid var(--vscode-panel-border); padding-top: 16px; }
    .label { border-radius: 4px; padding: 2px 8px; font-size: 0.8em; margin-right: 6px; color: #fff; }
    .labels { margin: 10px 0; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .status-line { display: flex; align-items: center; gap: 10px; margin: 4px 0 0 0; }
    .status { display: inline-block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; padding: 2px 10px; font-size: 0.85em; }
    .member-avatar { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.75em; font-weight: 600; flex-shrink: 0; margin-left: -4px; border: 2px solid var(--vscode-editor-background); }
    .member-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .priority { font-size: 0.85em; margin: 4px 0 0 0; margin-left: 0; }
    .dates { display: flex; gap: 20px; font-size: 0.85em; margin-top: 8px; }
    ul { padding-left: 20px; margin: 0; }
    li { margin-bottom: 4px; }
    p { margin: 0 0 8px 0; }
    .description { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
    .description p { margin: 0 0 8px 0; }
    .description img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }
    .description-section { background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
    .description-section h3 { display: flex; align-items: center; gap: 4px; }
    .description-title-text { cursor: pointer; }
    .description-title-text:hover { text-decoration: underline; }
    .description-title-input { font-size: 0.9em; font-weight: bold; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 2px 6px; }
    .description-delete-btn { background: transparent; border: none; cursor: pointer; padding: 2px 4px; font-size: 0.8em; opacity: 0.6; margin-left: auto; pointer-events: auto; }
    .description-delete-btn:hover { opacity: 1; }
    .description-content { margin-top: 8px; }
    .description-text { cursor: pointer; white-space: pre-wrap; word-break: break-word; }
    .description-text:hover { background: var(--vscode-editor-background); }
    .description-placeholder { color: var(--vscode-disabledForeground); font-style: italic; }
    .placeholder-text { color: var(--vscode-disabledForeground); font-style: italic; }
    .description-textarea { width: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 8px; font-family: var(--vscode-font-family); font-size: 0.9em; resize: vertical; min-height: 100px; }
    .description-edit-hint { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .add-description-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); }
    .add-description-form { display: flex; flex-direction: column; gap: 8px; }
    .new-description-title-input { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 8px; font-family: var(--vscode-font-family); font-size: 0.9em; }
    .new-description-content-input { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 8px; font-family: var(--vscode-font-family); font-size: 0.9em; resize: vertical; min-height: 80px; }
    .description-add-button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 8px 12px; font-size: 0.85em; cursor: pointer; align-self: flex-start; }
    .description-add-button:hover { background: var(--vscode-button-hoverBackground); }
    .comments { display: flex; flex-direction: column; gap: 12px; }
    .comment { background: var(--vscode-textBlockQuote-background); border-radius: 6px; padding: 10px 12px; max-width: 80%; }
    .comment.is-reply { margin-left: 24px; max-width: calc(80% - 24px); background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-focusBorder); }
    .comment.is-reply .comment-delete-btn,
    .comment.is-reply .comment-reply-btn { opacity: 0.7; }
    .comment.is-reply:hover .comment-delete-btn,
    .comment.is-reply:hover .comment-reply-btn { opacity: 1; }
    .reply-to-indicator { display: inline-flex; align-items: center; gap: 2px; color: var(--vscode-descriptionForeground); font-size: 0.8em; }
    .reply-to-avatar { width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.6em; font-weight: 600; flex-shrink: 0; }
    .reply-to-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .reply-to-indicator span { display: inline-flex; align-items: center; gap: 2px; }
    .reply-to-line { padding-left: 32px; margin-bottom: 2px; }
    .reply-preview { font-size: 0.8em; color: var(--vscode-descriptionForeground); border-left: 2px solid var(--vscode-focusBorder); padding-left: 8px; margin-top: 4px; font-style: italic; }
    .comment-header { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px; font-size: 0.85em; }
    .comment-header-info { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; flex: 1; }
    .comment-header-actions { display: flex; gap: 4px; }
    .comment-delete-btn { background: transparent; border: none; color: var(--vscode-errorForeground, #f85149); cursor: pointer; padding: 2px 6px; font-size: 0.85em; opacity: 0.6; transition: opacity 0.2s; border-radius: 4px; }
    .comment:hover .comment-delete-btn { opacity: 1; background: rgba(248, 81, 73, 0.1); }
    .comment:hover .comment-delete-btn { opacity: 0.7; }
    .comment-reply-btn { background: transparent; border: none; color: var(--vscode-focusBorder); cursor: pointer; padding: 2px 6px; font-size: 0.85em; opacity: 0.6; transition: opacity 0.2s; border-radius: 4px; }
    .comment:hover .comment-reply-btn { opacity: 1; }
    .comment-reply-btn:hover { text-decoration: underline; }
    .reply-box { display: none; margin-top: 8px; margin-left: 32px; }
    .reply-box.active { display: block; }
    .reply-box textarea { width: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 8px; font-family: var(--vscode-font-family); font-size: 0.9em; resize: vertical; min-height: 50px; }
    .reply-box-actions { display: flex; gap: 8px; margin-top: 6px; }
    .reply-box-actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 10px; font-size: 0.8em; cursor: pointer; }
    .reply-box-actions .reply-cancel { background: transparent; border: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); }
    .comment-delete-btn:hover { opacity: 1; background: rgba(248, 81, 73, 0.15); }
    .comment-avatar { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.7em; font-weight: 600; flex-shrink: 0; }
    .comment-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .comment-author { font-weight: 600; color: var(--vscode-foreground); }
    .comment-date { color: var(--vscode-descriptionForeground); }
    .comment-content { white-space: pre-wrap; word-break: break-word; }
    /* Comentários do utilizador atual alinhados à direita */
    .comment.is-own-comment { margin-left: auto; margin-right: 0; }
    .comment.is-own-comment .comment-header { flex-direction: row-reverse; }
    .add-comment { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); }
    .add-comment textarea { width: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 8px; font-family: var(--vscode-font-family); font-size: 0.9em; resize: vertical; min-height: 60px; }
    .add-comment textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .add-comment button { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 12px; font-size: 0.85em; cursor: pointer; }
    .add-comment button:hover { background: var(--vscode-button-hoverBackground); }
    .add-comment button:disabled { opacity: 0.5; cursor: not-allowed; }
    .history { display: flex; flex-direction: column; gap: 8px; }
    .history-item { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); max-width: 80%; }
    .history-header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    /* Histórico do utilizador atual alinhado à direita */
    .history-item.is-own-history { margin-left: auto; margin-right: 0; }
    .history-item.is-own-history .history-header { flex-direction: row-reverse; }
    .history-avatar { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.7em; font-weight: 600; flex-shrink: 0; margin-right: 4px; }
    .history-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .history-icon { font-size: 0.9em; }
    .history-text { color: var(--vscode-foreground); }
    .history-date { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .history-content { width: 100%; padding-left: 32px; margin-top: 2px; white-space: pre-wrap; }
    .image-gallery { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
    .image-gallery h4 { width: 100%; margin: 8px 0 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .image-preview img { opacity: 0.9; transition: opacity 0.2s; }
    .image-preview img:hover { opacity: 1; box-shadow: 0 0 8px rgba(0,0,0,0.3); }
    #image-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; }
    #image-modal.active { display: flex; }
    #image-modal img { max-width: 90%; max-height: 90%; border-radius: 8px; }
    #image-modal .close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 40px; cursor: pointer; }
    .card-title { cursor: pointer; border-radius: 4px; padding: 4px 8px; margin: -4px -8px; transition: background 0.2s; }
    .card-title:hover { background: var(--vscode-textBlockQuote-background); }
    .card-title-input { font-family: var(--vscode-font-family); font-size: 1.3em; font-weight: bold; width: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 2px solid var(--vscode-focusBorder); border-radius: 4px; padding: 4px 8px; margin: -6px -10px; }
    .card-title-input:focus { outline: none; }
    .save-hint { color: var(--vscode-descriptionForeground); font-size: 0.7em; margin-left: 8px; opacity: 0; transition: opacity 0.2s; }
    .card-title-input:focus + .save-hint { opacity: 1; }
    /* Attachments Section Styles */
    .attachments-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .attachment-item { display: flex; align-items: center; justify-content: space-between; background: var(--vscode-textBlockQuote-background); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
    .attachment-left { display: flex; align-items: center; gap: 12px; cursor: pointer; flex: 1; }
    .attachment-thumb { font-size: 1.5rem; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 4px; background: var(--vscode-editor-background); overflow: hidden; }
    .attachment-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .attachment-info { display: flex; flex-direction: column; }
    .attachment-name { font-weight: 600; font-size: 0.9em; color: var(--vscode-foreground); word-break: break-all; }
    .attachment-type { font-size: 0.75em; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
    .attachment-delete-btn { background: transparent; border: none; color: var(--vscode-errorForeground, #f85149); cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.1em; opacity: 0.7; transition: opacity 0.2s; border-radius: 4px; }
    .attachment-delete-btn:hover { opacity: 1; background: rgba(248, 81, 73, 0.1); }
    .attachment-button { display: inline-flex; align-items: center; gap: 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 12px; font-size: 0.85em; cursor: pointer; margin-top: 12px; }
    .attachment-button:hover { background: var(--vscode-button-hoverBackground); }
    .attachment-dropzone { border: 2px dashed var(--vscode-focusBorder, #007fd4); border-radius: 6px; padding: 16px; text-align: center; cursor: pointer; transition: all 0.2s; background: var(--vscode-editor-background); margin-top: 12px; }
    .attachment-dropzone:hover, .attachment-dropzone.drag-over { border-color: var(--vscode-focusBorder, #007fd4); background: var(--vscode-editor-inactiveSelectionBackground); }
    .attachment-dropzone.drag-over { border-style: solid; transform: scale(1.02); }
    .dropzone-content { display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
    .dropzone-icon { font-size: 1.5em; }
    .dropzone-text { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    /* Checklists */
    .checklist-section { background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
    .checklist-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .checklist-title { font-weight: bold; cursor: text; flex: 1; text-align: left; }
    .checklist-title:hover { background: var(--vscode-editorHighlightBackground); border-radius: 3px; }
    .checklist-title-input { flex: 1; padding: 2px 6px; border: 1px solid var(--vscode-focusBorder); border-radius: 3px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-weight: bold; font-size: inherit; }
    .checklist-progress { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-left: auto; }
    .checklist-delete-btn { background: none; border: none; cursor: pointer; font-size: 0.9em; opacity: 0.6; }
    .checklist-delete-btn:hover { opacity: 1; }
    .checklist-items { margin-bottom: 8px; }
    .checklist-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; flex-wrap: wrap; }
    .checklist-item-text { flex: 1; cursor: text; min-width: 100px; }
    .checklist-item-text:hover { background: var(--vscode-editorHighlightBackground); border-radius: 3px; }
    .checklist-item-text.checked { text-decoration: line-through; opacity: 0.6; }
    .checklist-item-input { flex: 1; padding: 2px 6px; border: 1px solid var(--vscode-focusBorder); border-radius: 3px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: inherit; }
    .checklist-item-members { display: flex; align-items: center; gap: 2px; }
    .checklist-item-member-avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--vscode-focusBorder); display: flex; align-items: center; justify-content: center; font-size: 0.7em; color: var(--vscode-foreground); position: relative; margin-left: -4px; border: 2px solid var(--vscode-editor-background); }
    .checklist-item-member-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .checklist-item-member-overflow { width: 24px; height: 24px; border-radius: 50%; background: var(--vscode-button-secondaryBackground); display: flex; align-items: center; justify-content: center; font-size: 0.65em; color: var(--vscode-foreground); margin-left: -4px; border: 2px solid var(--vscode-editor-background); }
    .checklist-item-member-btn { background: none; border: none; cursor: pointer; font-size: 0.9em; opacity: 0.6; padding: 2px; }
    .checklist-item-member-btn:hover { opacity: 1; }
    .checklist-item-member-menu { position: absolute; background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); border-radius: 6px; padding: 8px; max-height: 200px; overflow-y: auto; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3); min-width: 180px; }
    .checklist-item-member-menu-header { font-weight: bold; font-size: 0.85em; margin-bottom: 8px; color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-focusBorder); padding-bottom: 4px; }
    .checklist-item-member-menu-list { display: flex; flex-direction: column; gap: 2px; }
    .checklist-item-member-option { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: 4px; font-size: 0.85em; }
    .checklist-item-member-option:hover { background: var(--vscode-button-secondaryBackground); }
    .checklist-item-member-option.selected { background: var(--vscode-button-hoverBackground); }
    .checklist-item-member-option-img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
    .checklist-item-delete { background: none; border: none; cursor: pointer; font-size: 0.9em; opacity: 0.6; }
    .checklist-item-delete:hover { opacity: 1; }
    .checklist-add-item { display: flex; gap: 8px; margin-top: 8px; }
    .checklist-new-item-input { flex: 1; padding: 4px 8px; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
    .checklist-add-item-btn { padding: 4px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    .checklist-add-section { display: flex; gap: 8px; margin-top: 12px; }
    .checklist-title-input { flex: 1; padding: 6px 8px; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
    .checklist-button { padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    .checklist-button:hover { background: var(--vscode-button-hoverBackground); }
    /* Membros */
    .status-line { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .member-wrapper { position: relative; display: inline-block; }
    .member-avatar.member-img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
    .member-remove { position: absolute; top: -4px; right: -4px; width: 14px; height: 14px; background: #e74c3c; color: white; border-radius: 50%; font-size: 10px; line-height: 12px; text-align: center; cursor: pointer; display: none; }
    .member-wrapper:hover .member-remove { display: block; }
    .add-member-btn { width: 24px; height: 24px; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; font-size: 14px; cursor: pointer; margin-left: 4px; }
    .add-member-btn:hover { background: var(--vscode-button-hoverBackground); }
    .add-member-menu { position: absolute; background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 100; min-width: 180px; max-height: 200px; overflow-y: auto; }
    .add-member-header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-focusBorder); font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    .close-menu { cursor: pointer; font-size: 16px; }
    .add-member-option { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
    .add-member-option:hover { background: var(--vscode-button-hoverBackground); }
    .option-avatar { width: 20px; height: 20px; border-radius: 50%; background: var(--vscode-button-background); display: flex; align-items: center; justify-content: center; font-size: 10px; }
    .option-avatar img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
    .option-name { font-size: 0.9em; }
    .section-toggle { cursor: pointer; margin-right: 4px; }
    .section-toggle:hover { opacity: 0.7; }
  </style>
</head>
<body>
  <h1 class="card-title" id="card-title" ondblclick="window.startEditTitle()">${this.escape(card.title)}</h1>
  <input type="text" id="title-input" class="card-title-input" style="display:none;" value="${this.escape(card.title)}">
  <span class="save-hint">Enter para guardar | Esc para cancelar</span>
  <div class="status-line">
    <span class="status">${this.escape(card.status_label)}</span>
    ${membersAvatars}
    ${addMemberButton}
  </div>
  <div id="add-member-menu" class="add-member-menu" style="display:none;">
    <div class="add-member-header">Adicionar Membro <span class="close-menu" onclick="window.closeAddMemberMenu()">×</span></div>
    <div class="add-member-list">
      ${availableParticipants.map((p) => `
        <div class="add-member-option" onclick="window.addMember('${this.escape(p.email)}')">
          ${p.icon_url ? `<img class="option-avatar" src="${p.icon_url}">` : `<span class="option-avatar">${(p.name || p.email || "?").substring(0, 1).toUpperCase()}</span>`}
          <span class="option-name">${this.escape(p.name || p.email)}</span>
        </div>
      `).join('')}
    </div>
  </div>
  <div class="priority">${PRIORITY_LABELS[card.priority] ?? card.priority}</div>
  ${dates}
  <div class="labels">${labels}</div>
  ${checklistsHtml}
  ${descriptionHtml}
  ${attachmentsHtml}
  ${commentsHtml}
  ${historyHtml}
  <script>
    window.showImage = function(dataUrl) {
      var modal = document.getElementById('image-modal');
      var modalImg = document.getElementById('modal-img');
      if (modal && modalImg) {
        modalImg.src = dataUrl;
        modal.classList.add('active');
      }
    };
    window.closeModal = function() {
      var modal = document.getElementById('image-modal');
      if (modal) modal.classList.remove('active');
    };
    // Converter imagens base64 para blobs para evitar bloqueios do VS Code webview
    function processImages() {
      document.querySelectorAll('img').forEach(function(img) {
        var src = img.getAttribute('src');
        if (src && src.startsWith('data:')) {
          try {
            var parts = src.split(',');
            var mimeMatch = src.match(/^data:([^;]+);base64,/);
            if (mimeMatch && parts.length > 1) {
              var mimeType = mimeMatch[1];
              var base64Data = parts[1];
              var binaryString = atob(base64Data);
              var bytes = new Uint8Array(binaryString.length);
              for (var i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              var blob = new Blob([bytes], { type: mimeType });
              img.src = URL.createObjectURL(blob);
            }
          } catch (e) {
            // Se falhar, mantém a imagem como está
          }
        }
      });
    }
    processImages();

    // Obter a API do VS Code para enviar mensagens
    var vscode = acquireVsCodeApi();
    // DEFINIR cardId PRIMEIRO - necessário para os cliques nos botões
    window.cardId = ${card.id};

    // Fix: garantir que descrições vazias mostram o placeholder
    (function() {
      var descTexts = document.querySelectorAll('.description-text');
      descTexts.forEach(function(el) {
        var content = el.textContent || '';
        if (!content || !content.replace(/^\s+|\s+$/g, '')) {
          el.innerHTML = '<em class="description-placeholder">Duplo clique para editar...</em>';
        }
      });
    })();

    // Handler do botão adicionar comentário
    var commentBtn = document.getElementById('add-comment-btn');
    if (commentBtn) {
      commentBtn.addEventListener('click', function(e) {
        e.preventDefault();
        addComment();
      });
    }

    // Handler para adicionar comentário (reutilizável)
    function addComment() {
      var textarea = document.getElementById('new-comment');
      var btn = document.getElementById('add-comment-btn');
      if (!textarea || !btn) return;

      var content = textarea.value.trim();
      if (!content) return;

      btn.disabled = true;
      btn.textContent = 'A enviar...';

      vscode.postMessage({ command: 'addComment', cardId: window.cardId, content: content });
    }

    // Enter para adicionar comentário, Shift+Enter para nova linha
    var commentTextarea = document.getElementById('new-comment');
    if (commentTextarea) {
      commentTextarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          addComment();
        }
      });
    }

    // Receber resposta da extensão
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.command === 'commentAdded') {
        var ta = document.getElementById('new-comment');
        if (ta) ta.value = '';
        // Recarregar após pequeno delay para evitar flicker
        setTimeout(function() { location.reload(); }, 100);
      } else if (msg.command === 'commentDeleted') {
        setTimeout(function() { location.reload(); }, 100);
      } else if (msg.command === 'commentError') {
        var btn = document.getElementById('add-comment-btn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Adicionar Comentário';
        }
        alert('Erro ao adicionar comentário: ' + msg.error);
      } else if (msg.command === 'commentDeleteError') {
        alert('Erro ao eliminar comentário: ' + msg.error);
      } else if (msg.command === 'attachmentError') {
        var attBtn = document.getElementById('add-attachment-btn');
        if (attBtn) {
          attBtn.disabled = false;
          attBtn.textContent = '📎 Adicionar Anexo';
        }
      }
    });

    // Handler para eliminar comentário
    window.deleteComment = function(event, commentId) {
      event.stopPropagation();
      // confirm() não está disponível em webviews do VS Code — eliminar diretamente
      vscode.postMessage({ command: 'deleteComment', commentId: commentId });
    };

    // Event delegation para botões de resposta (mais fiável que inline onclick)
    document.addEventListener('click', function(e) {
      var replyBtn = e.target.closest('.comment-reply-btn');
      if (replyBtn) {
        var commentId = parseInt(replyBtn.getAttribute('data-comment-id'), 10);
        var parentId = parseInt(replyBtn.getAttribute('data-parent-id'), 10);
        window.showReplyBox(commentId, parentId);
      }
    });

    // Mostrar caixa de resposta
    window.showReplyBox = function(commentId, parentId) {
      console.log('[showReplyBox] commentId:', commentId, 'parentId:', parentId);
      // parentId é o ID do comentário principal (se vier null/undefined, usar commentId)
      if (!parentId || isNaN(parentId)) parentId = commentId;

      // Fechar outras caixas de resposta abertas
      var allBoxes = document.querySelectorAll('.reply-box');
      allBoxes.forEach(function(el) {
        el.parentNode.removeChild(el);
      });

      // Encontrar o elemento do comentário
      var commentEl = document.querySelector('.comment[data-comment-id="' + commentId + '"]');
      if (!commentEl) return;

      // Criar a reply-box dentro do comentário clicado
      var replyBox = document.createElement('div');
      replyBox.className = 'reply-box active';
      replyBox.innerHTML = '<textarea placeholder="Escreve uma resposta..." rows="2"></textarea>' +
        '<div class="reply-box-actions">' +
        '<button class="reply-send-btn">Enviar</button>' +
        '<button class="reply-cancel-btn">Cancelar</button>' +
        '</div>';
      commentEl.appendChild(replyBox);

      // Handler para enviar
      var sendBtn = replyBox.querySelector('.reply-send-btn');
      console.log('[showReplyBox] sendBtn:', sendBtn, 'parentId:', parentId);
      sendBtn.addEventListener('click', function() {
        console.log('[showReplyBox] Send clicked, parentId:', parentId);
        var textarea = replyBox.querySelector('textarea');
        var content = textarea.value.trim();
        if (content) {
          vscode.postMessage({ command: 'addComment', cardId: window.cardId, content: content, parentId: parentId });
        }
      });

      // Handler para cancelar
      var cancelBtn = replyBox.querySelector('.reply-cancel-btn');
      cancelBtn.addEventListener('click', function() {
        replyBox.parentNode.removeChild(replyBox);
      });

      // Focus no textarea e handler para Enter/Shift+Enter
      setTimeout(function() {
        var textarea = replyBox.querySelector('textarea');
        textarea.focus();
        textarea.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
          }
        });
      }, 50);
    };

    // Funções de Anexos
    window.openAttachment = function(idx) {
      // Para imagens: abrir no modal diretamente (sem ir ao host)
      var items = document.querySelectorAll('.attachment-item');
      var item = items[idx];
      if (item) {
        var img = item.querySelector('.attachment-thumb img');
        if (img) {
          var modal = document.getElementById('image-modal');
          var modalImg = document.getElementById('modal-img');
          if (modal && modalImg) {
            modalImg.src = img.src;
            modal.classList.add('active');
          }
          return;
        }
      }
      // Para outros tipos: enviar ao host para abrir externamente
      vscode.postMessage({ command: 'openAttachment', cardId: window.cardId, index: idx });
    };

    window.deleteAttachment = function(event, idx) {
      event.stopPropagation();
      // confirm() não está disponível em webviews do VS Code — apagar diretamente
      vscode.postMessage({ command: 'deleteAttachment', cardId: window.cardId, index: idx });
    };

    // Configurar drag & drop para anexos
    var attDropzone = document.getElementById('attachment-dropzone');
    var attBtn = document.getElementById('add-attachment-btn');
    var attInput = document.getElementById('attachment-input');

    function handleFileSelect(files) {
      if (!files || !files.length) return;
      attBtn.disabled = true;
      attBtn.textContent = 'A processar...';

      var promises = Array.from(files).map(function(file) {
        return new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onloadend = function() {
            resolve({
              name: file.name,
              url: reader.result,
              type: file.type
            });
          };
          reader.readAsDataURL(file);
        });
      });

      Promise.all(promises).then(function(loadedFiles) {
        vscode.postMessage({
          command: 'addAttachments',
          cardId: window.cardId,
          files: loadedFiles
        });
        attInput.value = '';
        attBtn.disabled = false;
        attBtn.textContent = '📎 Adicionar Anexo';
      }).catch(function(err) {
        attBtn.disabled = false;
        attBtn.textContent = '📎 Adicionar Anexo';
        alert('Erro ao ler ficheiros: ' + err);
      });
    }

    if (attDropzone) {
      attDropzone.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        attDropzone.classList.add('drag-over');
      });
      attDropzone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        attDropzone.classList.remove('drag-over');
      });
      attDropzone.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        attDropzone.classList.remove('drag-over');
        var files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          handleFileSelect(files);
        }
      });
      attDropzone.addEventListener('click', function() {
        attInput?.click();
      });
    }

    if (attBtn && attInput) {
      attBtn.addEventListener('click', function() {
        attInput.click();
      });
      attInput.addEventListener('change', function(e) {
        var files = Array.from(e.target.files);
        handleFileSelect(files);
      });
    }

    // Edição inline do título
    window.startEditTitle = function() {
      var titleEl = document.getElementById('card-title');
      var inputEl = document.getElementById('title-input');
      if (titleEl && inputEl) {
        titleEl.style.display = 'none';
        inputEl.style.display = 'block';
        inputEl.focus();
        inputEl.select();
      }
    };
    window.saveTitle = function() {
      var inputEl = document.getElementById('title-input');
      var titleEl = document.getElementById('card-title');
      if (inputEl && titleEl) {
        var newTitle = inputEl.value.trim();
        if (newTitle && newTitle !== titleEl.textContent) {
          window.updateCardTitle(newTitle);
        }
        inputEl.style.display = 'none';
        titleEl.style.display = 'block';
      }
    };
    window.cancelEditTitle = function() {
      var inputEl = document.getElementById('title-input');
      var titleEl = document.getElementById('card-title');
      if (inputEl && titleEl) {
        inputEl.value = titleEl.textContent || '';
        inputEl.style.display = 'none';
        titleEl.style.display = 'block';
      }
    };
    // Enter para guardar, Esc para cancelar
    document.getElementById('title-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.saveTitle();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        window.cancelEditTitle();
      }
    });
    document.getElementById('title-input').addEventListener('blur', function() {
      // Pequeno delay para permitir clique no botão guardar
      setTimeout(function() {
        var inputEl = document.getElementById('title-input');
        if (inputEl && inputEl.style.display !== 'none') {
          window.saveTitle();
        }
      }, 200);
    });
    // Comunicar com a extensão para guardar o título
    window.updateCardTitle = function(newTitle) {
      vscode.postMessage({ command: 'updateCardTitle', cardId: window.cardId, title: newTitle });
    };
    window.updateCardTitleSuccess = function(newTitle) {
      var titleEl = document.getElementById('card-title');
      if (titleEl) {
        titleEl.textContent = newTitle;
      }
    };

    // Funções para adicionar/remover membros
    window.showAddMemberMenu = function(event) {
      event.stopPropagation();
      var menu = document.getElementById('add-member-menu');
      if (menu) menu.style.display = 'block';
    };
    window.closeAddMemberMenu = function() {
      var menu = document.getElementById('add-member-menu');
      if (menu) menu.style.display = 'none';
    };
    window.addMember = function(email) {
      window.closeAddMemberMenu();
      vscode.postMessage({ command: 'addMember', cardId: window.cardId, email: email });
    };
    window.removeMember = function(event, email) {
      event.stopPropagation();
      vscode.postMessage({ command: 'removeMember', cardId: window.cardId, email: email });
    };

    // Checklists
    window.addChecklist = function() {
      var titleInput = document.getElementById('checklist-title-input');
      if (!titleInput || !titleInput.value.trim()) {
        alert('Digite o título do checklist');
        return;
      }
      vscode.postMessage({ command: 'addChecklist', cardId: window.cardId, title: titleInput.value.trim() });
      titleInput.value = '';
    };
    // Descriptions
    window.addDescription = function() {
      // Cria uma nova descrição com título "Nova Descrição" e conteúdo padrão
      vscode.postMessage({ command: 'addDescription', cardId: window.cardId, title: 'Nova Descrição', content: 'Duplo clique para editar...' });
    };
    window.editDescriptionTitle = function(idx) {
      var titleSpan = document.querySelectorAll('.description-title-text')[idx];
      var titleInput = document.getElementById('description-title-edit-' + idx);
      if (titleSpan && titleInput) {
        titleInput.setAttribute('data-original', titleSpan.textContent);
        titleInput.value = titleSpan.textContent;
        titleSpan.style.display = 'none';
        titleInput.style.display = 'inline-block';
        titleInput.focus();
        titleInput.onblur = function() {
          window.saveDescriptionTitle(idx);
        };
        titleInput.onkeydown = function(event) {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            window.saveDescriptionTitle(idx);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            window.cancelDescriptionTitleEdit(idx);
          }
        };
      }
    };
    window.saveDescriptionTitle = function(idx) {
      var titleSpan = document.querySelectorAll('.description-title-text')[idx];
      var titleInput = document.getElementById('description-title-edit-' + idx);
      var contentDiv = document.querySelectorAll('.description-text')[idx];
      var contentArea = document.getElementById('description-edit-' + idx);
      if (titleSpan && titleInput && contentDiv) {
        var newTitle = titleInput.value.trim();
        if (newTitle) {
          vscode.postMessage({ command: 'updateDescription', cardId: window.cardId, index: idx, title: newTitle, content: contentDiv.textContent });
        }
        titleInput.style.display = 'none';
        titleSpan.style.display = '';
      }
    };
    window.cancelDescriptionTitleEdit = function(idx) {
      var titleSpan = document.querySelectorAll('.description-title-text')[idx];
      var titleInput = document.getElementById('description-title-edit-' + idx);
      if (titleSpan && titleInput) {
        var original = titleInput.getAttribute('data-original') || titleSpan.textContent;
        titleInput.value = original;
        titleInput.style.display = 'none';
        titleSpan.style.display = '';
      }
    };
    window.cancelDescriptionContentEdit = function(idx) {
      var contentDiv = document.querySelectorAll('.description-text')[idx];
      var contentArea = document.getElementById('description-edit-' + idx);
      var hint = contentArea ? contentArea.nextElementSibling : null;
      if (contentDiv && contentArea) {
        var original = contentArea.getAttribute('data-original') || contentDiv.textContent;
        contentArea.value = original;
        contentArea.style.display = 'none';
        contentDiv.style.display = '';
        if (hint) hint.style.display = 'none';
      }
    };
    window.editDescriptionContent = function(idx) {
      var contentDiv = document.querySelectorAll('.description-text')[idx];
      var contentArea = document.getElementById('description-edit-' + idx);
      var hint = contentArea ? contentArea.nextElementSibling : null;
      if (contentDiv && contentArea) {
        var placeholderText = 'Duplo clique para editar...';
        var content = contentDiv.textContent;
        // If showing placeholder, start with empty textarea
        if (content === placeholderText) {
          contentArea.setAttribute('data-original', '');
          contentArea.value = '';
        } else {
          contentArea.setAttribute('data-original', content);
          contentArea.value = content;
        }
        contentDiv.style.display = 'none';
        contentArea.style.display = 'block';
        contentArea.focus();
        contentArea.onblur = function() {
          window.saveDescriptionContent(idx);
        };
        contentArea.onkeydown = function(event) {
          event.stopPropagation();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            window.saveDescriptionContent(idx);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            window.cancelDescriptionContentEdit(idx);
          }
          // Shift+Enter faz nova linha automaticamente
        };
        if (hint) hint.style.display = 'block';
      }
    };
    window.saveDescriptionContent = function(idx) {
      var contentDiv = document.querySelectorAll('.description-text')[idx];
      var contentArea = document.getElementById('description-edit-' + idx);
      var hint = contentArea ? contentArea.nextElementSibling : null;
      if (contentDiv && contentArea) {
        var newContent = contentArea.value;
        var titleSpan = document.querySelectorAll('.description-title-text')[idx];
        // Don't save placeholder text - treat as empty
        var placeholderText = 'Duplo clique para editar...';
        if (newContent === placeholderText) {
          newContent = '';
        }
        // Save to database (even if empty - this clears the description)
        vscode.postMessage({ command: 'updateDescription', cardId: window.cardId, index: idx, title: titleSpan.textContent, content: newContent });
        // Update UI to show placeholder if empty, or content if there's text
        contentArea.style.display = 'none';
        contentDiv.style.display = '';
        if (hint) hint.style.display = 'none';
      }
    };
    window.deleteDescription = function(idx) {
      console.log('[deleteDescription] Deleting description at index:', idx);
      vscode.postMessage({ command: 'deleteDescription', cardId: window.cardId, index: idx });
    };
    window.addChecklistItemKeypress = function(event, idx) {
      if (event.key === 'Enter') {
        window.addChecklistItem(idx);
      }
    };
    window.addChecklistItem = function(idx) {
      var section = document.querySelectorAll('.checklist-section')[idx];
      if (!section) return;
      var input = section.querySelector('.checklist-new-item-input');
      if (!input || !input.value.trim()) {
        return;
      }
      vscode.postMessage({ command: 'addChecklistItem', cardId: window.cardId, checklistIndex: idx, text: input.value.trim() });
      input.value = '';
    };
    window.toggleChecklistItem = function(checklistIdx, itemIdx, checked) {
      vscode.postMessage({ command: 'toggleChecklistItem', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx, checked: checked });
    };
    window.deleteChecklistItem = function(checklistIdx, itemIdx) {
      vscode.postMessage({ command: 'deleteChecklistItem', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx });
    };
    window.toggleChecklistItemMemberMenu = function(checklistIdx, itemIdx) {
      var menu = document.getElementById('checklist-item-member-menu-' + checklistIdx + '-' + itemIdx);
      // Close all other menus
      document.querySelectorAll('.checklist-item-member-menu').forEach(function(m) {
        if (m !== menu) m.style.display = 'none';
      });
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    };
    window.toggleChecklistItemMember = function(checklistIdx, itemIdx, email) {
      vscode.postMessage({ command: 'toggleChecklistItemMember', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx, email: email });
      // Close menu
      var menu = document.getElementById('checklist-item-member-menu-' + checklistIdx + '-' + itemIdx);
      if (menu) menu.style.display = 'none';
    };
    window.removeChecklistItemMember = function(checklistIdx, itemIdx, email) {
      if (email === null) {
        vscode.postMessage({ command: 'removeChecklistItemMembers', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx });
      } else {
        vscode.postMessage({ command: 'toggleChecklistItemMember', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx, email: email });
      }
      var menu = document.getElementById('checklist-item-member-menu-' + checklistIdx + '-' + itemIdx);
      if (menu) menu.style.display = 'none';
    };
    // Toggle section collapse/expand
    window.toggleSection = function(sectionId) {
      var el = document.getElementById(sectionId);
      var h3 = el ? el.previousElementSibling : null;
      var toggle = h3 ? h3.querySelector('.section-toggle') : null;
      if (el) {
        if (el.style.display === 'none') {
          el.style.display = '';
          if (toggle) toggle.textContent = '▾';
        } else {
          el.style.display = 'none';
          if (toggle) toggle.textContent = '▸';
        }
      }
    };
    // Close member menus when clicking outside
    document.addEventListener('click', function(event) {
      if (!event.target.classList.contains('checklist-item-member-btn')) {
        document.querySelectorAll('.checklist-item-member-menu').forEach(function(m) {
          m.style.display = 'none';
        });
      }
    });
    window.editChecklistItemText = function(checklistIdx, itemIdx) {
      var textSpan = document.querySelectorAll('.checklist-item-text')[checklistIdx * 100 + itemIdx];
      var textInput = document.getElementById('checklist-item-edit-' + checklistIdx + '-' + itemIdx);
      if (textSpan && textInput) {
        textInput.setAttribute('data-original', textSpan.textContent);
        textInput.value = textSpan.textContent;
        textSpan.style.display = 'none';
        textInput.style.display = 'inline-block';
        textInput.focus();
        textInput.select();
        // Add blur listener to save on blur
        textInput.onblur = function() {
          window.saveChecklistItemText(checklistIdx, itemIdx);
        };
      }
    };
    window.saveChecklistItemTextKeypress = function(event, checklistIdx, itemIdx) {
      if (event.key === 'Enter') {
        window.saveChecklistItemText(checklistIdx, itemIdx);
      } else if (event.key === 'Escape') {
        window.cancelChecklistItemTextEdit(checklistIdx, itemIdx);
      }
    };
    window.saveChecklistItemText = function(checklistIdx, itemIdx) {
      var textSpan = document.querySelectorAll('.checklist-item-text')[checklistIdx * 100 + itemIdx];
      var textInput = document.getElementById('checklist-item-edit-' + checklistIdx + '-' + itemIdx);
      if (textSpan && textInput) {
        var newText = textInput.value.trim();
        if (newText) {
          vscode.postMessage({ command: 'updateChecklistItemText', cardId: window.cardId, checklistIndex: checklistIdx, itemIndex: itemIdx, text: newText });
        }
        textInput.style.display = 'none';
        textSpan.style.display = 'inline';
      }
    };
    window.cancelChecklistItemTextEdit = function(checklistIdx, itemIdx) {
      var textSpan = document.querySelectorAll('.checklist-item-text')[checklistIdx * 100 + itemIdx];
      var textInput = document.getElementById('checklist-item-edit-' + checklistIdx + '-' + itemIdx);
      if (textSpan && textInput) {
        var originalText = textInput.getAttribute('data-original') || '';
        textInput.value = originalText;
        textInput.style.display = 'none';
        textSpan.style.display = 'inline';
      }
    };
    window.editChecklistTitle = function(checklistIdx) {
      var titleSpan = document.querySelectorAll('.checklist-title')[checklistIdx];
      var titleInput = document.getElementById('checklist-title-edit-' + checklistIdx);
      if (titleSpan && titleInput) {
        // Store original value
        titleInput.setAttribute('data-original', titleSpan.textContent);
        titleInput.value = titleSpan.textContent;
        titleSpan.style.display = 'none';
        titleInput.style.display = 'inline-block';
        titleInput.focus();
        titleInput.select();
        // Add blur listener to save on blur
        titleInput.onblur = function() {
          window.saveChecklistTitle(checklistIdx);
        };
      }
    };
    window.saveChecklistTitleKeypress = function(event, checklistIdx) {
      if (event.key === 'Enter') {
        window.saveChecklistTitle(checklistIdx);
      } else if (event.key === 'Escape') {
        window.cancelChecklistTitleEdit(checklistIdx);
      }
    };
    window.cancelChecklistTitleEdit = function(checklistIdx) {
      var titleSpan = document.querySelectorAll('.checklist-title')[checklistIdx];
      var titleInput = document.getElementById('checklist-title-edit-' + checklistIdx);
      if (titleSpan && titleInput) {
        var originalTitle = titleInput.getAttribute('data-original') || '';
        titleInput.value = originalTitle;
        titleInput.style.display = 'none';
        titleSpan.style.display = 'inline';
      }
    };
    window.saveChecklistTitle = function(checklistIdx) {
      var titleSpan = document.querySelectorAll('.checklist-title')[checklistIdx];
      var titleInput = document.getElementById('checklist-title-edit-' + checklistIdx);
      if (titleSpan && titleInput) {
        var newTitle = titleInput.value.trim();
        if (newTitle) {
          vscode.postMessage({ command: 'updateChecklistTitle', cardId: window.cardId, checklistIndex: checklistIdx, title: newTitle });
        }
        titleInput.style.display = 'none';
        titleSpan.style.display = 'inline';
      }
    };
    window.deleteChecklist = function(idx) {
      vscode.postMessage({ command: 'deleteChecklist', cardId: window.cardId, checklistIndex: idx });
    };

    // Fechar menu ao clicar fora
    document.addEventListener('click', function(event) {
      var menu = document.getElementById('add-member-menu');
      var btn = document.querySelector('.add-member-btn');
      if (menu && btn && !menu.contains(event.target) && !btn.contains(event.target)) {
        menu.style.display = 'none';
      }
    });
    // Global keydown handler for Escape - cancel any active edit
    document.addEventListener('keydown', function(e) {
      // Escape key - cancel editing
      if (e.key === 'Escape') {
        e.preventDefault();
        // Find all visible inputs and textareas
        var allInputs = document.querySelectorAll('input[type="text"], textarea');
        for (var k = 0; k < allInputs.length; k++) {
          var inp = allInputs[k];
          var style = window.getComputedStyle(inp);
          if (style.display !== 'none') {
            var id = inp.id || '';
            if (id.startsWith('checklist-title-edit-')) {
              var idx = parseInt(id.replace('checklist-title-edit-', ''));
              window.cancelChecklistTitleEdit(idx);
              return;
            } else if (id.startsWith('checklist-item-edit-')) {
              var parts = id.replace('checklist-item-edit-', '').split('-');
              var cIdx = parseInt(parts[0]);
              var iIdx = parseInt(parts[1]);
              window.cancelChecklistItemTextEdit(cIdx, iIdx);
              return;
            } else if (id === 'title-input') {
              window.cancelEditTitle();
              return;
            } else if (id.startsWith('description-title-edit-')) {
              var idx = parseInt(id.replace('description-title-edit-', ''));
              window.cancelDescriptionTitleEdit(idx);
              return;
            } else if (id.startsWith('description-edit-')) {
              var idx = parseInt(id.replace('description-edit-', ''));
              window.cancelDescriptionContentEdit(idx);
              return;
            }
          }
        }
      }
      // Enter key in inputs - save (not in textarea unless Shift is NOT pressed)
      if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.tagName === 'TEXTAREA' && !e.shiftKey))) {
        if (e.target.tagName === 'TEXTAREA') {
          // In textarea, Enter without Shift saves
          e.preventDefault();
        }
        var inp = e.target;
        var id = inp.id || '';
        if (id.startsWith('checklist-title-edit-')) {
          var idx = parseInt(id.replace('checklist-title-edit-', ''));
          window.saveChecklistTitle(idx);
        } else if (id.startsWith('checklist-item-edit-')) {
          var parts = id.replace('checklist-item-edit-', '').split('-');
          var cIdx = parseInt(parts[0]);
          var iIdx = parseInt(parts[1]);
          window.saveChecklistItemText(cIdx, iIdx);
        } else if (id === 'title-input') {
          window.saveEditTitle();
        } else if (id.startsWith('description-title-edit-')) {
          var idx = parseInt(id.replace('description-title-edit-', ''));
          window.saveDescriptionTitle(idx);
        } else if (id.startsWith('description-edit-')) {
          var idx = parseInt(id.replace('description-edit-', ''));
          window.saveDescriptionContent(idx);
        }
        return;
      }
    });
    </script>
  <div id="image-modal" onclick="window.closeModal()">
    <span class="close" onclick="window.closeModal()">&times;</span>
    <img id="modal-img" src="" alt="Imagem ampliada">
  </div>
</body>
</html>`;
  }

  // Escapa HTML para prevenir XSS mas permite parágrafos e quebras de linha
  private renderHtml(str: string | undefined): string {
    if (!str) return '';
    // Primeiro escapa caracteres perigosos mas permite tags HTML
    let safe = str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    // Substitui \n por <br> para quebras de linha visíveis
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  // Substitui tags img por miniaturas clicáveis na descrição
  private renderDescriptionWithImages(str: string | undefined): string {
    if (!str) return '';
    let safe = str;
    // Substituir TODAS as tags img com data URLs ANTES de qualquer escaping
    // Usar um placeholder único para não ter problemas com escaping
    const placeholder = '___IMG_PLACEHOLDER___';
    let idx = 0;
    const dataUrls: string[] = [];
    safe = safe.replace(/<img([^>]+)src=["'](data:image\/[^;"']+;base64,[^"']+)["']([^>]*)>/gi, (match) => {
      const dataUrl = match.match(/src=["'](data:image\/[^;"']+;base64,[^"']+)["']/)?.[1] || '';
      dataUrls.push(dataUrl);
      return `${placeholder}${idx++}`;
    });
    // Agora fazer o escaping normal
    safe = safe
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
    // Substituir placeholders pelas imagens em miniatura (serão convertidas para blob pelo processImages)
    dataUrls.forEach((url, i) => {
      const img = `<img src="${url}" onclick="window.showImage('${url}')" style="cursor:pointer;max-width:150px;max-height:150px;border-radius:4px;margin:8px 0;opacity:0.9;" title="Clicar para ampliar">`;
      safe = safe.replace(`${placeholder}${i}`, img);
    });
    return safe;
  }

  // Escapa texto simples sem HTML
  private escape(str: string | undefined): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
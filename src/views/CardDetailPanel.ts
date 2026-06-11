import * as vscode from 'vscode';
import { Card, Comment, boardsClient } from '../api/boardsClient';

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '🔴 Urgente',
  high: '🟠 Alta',
  medium: '🟡 Média',
  low: '🟢 Baixa',
};

export class CardDetailPanel {
  private static panels = new Map<number, CardDetailPanel>();
  private readonly panel: vscode.WebviewPanel;
  private card: Card;

  private constructor(card: Card) {
    this.card = card;
    this.panel = vscode.window.createWebviewPanel(
      'anturio.cardDetail',
      card.title,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.loadComments(card.id);
    this.panel.webview.html = this.buildHtml(card, []);
    this.panel.onDidDispose(() => CardDetailPanel.panels.delete(card.id));
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private async handleMessage(msg: { command: string; cardId?: number; title?: string }): Promise<void> {
    if (msg.command === 'updateCardTitle' && msg.cardId && msg.title) {
      try {
        const updated = await boardsClient.updateCard(msg.cardId, { title: msg.title });
        this.card.title = updated.title;
        this.panel.title = updated.title;
        this.panel.webview.postMessage({ command: 'updateCardTitleSuccess', title: updated.title });
      } catch (err) {
        console.error('Erro ao actualizar título:', err);
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
      this.panel.webview.html = this.buildHtml(this.card, activities);
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

  private buildHtml(card: Card, activities: Comment[]): string {
    const labels = card.labels
      .map((l) => `<span class="label" style="background:${this.escape(l.color)}">${this.escape(l.text)}</span>`)
      .join('');

    const members = card.members.length > 0
      ? `<section>
          <h3>Membros</h3>
          <ul>${card.members.map((m) => `<li>${this.escape(m.name)} <span class="meta">${this.escape(m.email)}</span></li>`).join('')}</ul>
        </section>`
      : '';

    const dates = (card.start_date || card.due_date)
      ? `<div class="dates">
          ${card.start_date ? `<span>Início: <b>${new Date(card.start_date).toLocaleDateString('pt-PT')}</b></span>` : ''}
          ${card.due_date ? `<span>Prazo: <b>${new Date(card.due_date).toLocaleDateString('pt-PT')}</b></span>` : ''}
        </div>`
      : '';

    const comments = activities.filter((a) => a.type === 'comment').reverse();
    const history = activities.filter((a) => a.type !== 'comment').reverse();

    const commentsHtml = comments.length > 0
      ? `<section>
          <h3>Comentários (${comments.length})</h3>
          <div class="comments">
            ${comments.map((c) => `
              <div class="comment">
                <div class="comment-header">
                  <span class="comment-author">${this.escape(c.user_name || c.user_email)}</span>
                  <span class="comment-date">${new Date(c.created_at).toLocaleString('pt-PT')}</span>
                </div>
                <div class="comment-content">${this.renderHtml(c.content)}</div>
              </div>
            `).join('')}
          </div>
        </section>`
      : '<section><h3>Comentários</h3><p class="meta">Sem comentários ainda.</p></section>';

    const historyHtml = history.length > 0
      ? `<section>
          <h3>Histórico (${history.length})</h3>
          <div class="history">
            ${history.map((h) => `
              <div class="history-item">
                <span class="history-icon">${this.getActivityIcon(h.type)}</span>
                <span class="history-text">${this.escape(h.user_name || h.user_email)}</span>
                <span class="history-date">${new Date(h.created_at).toLocaleString('pt-PT')}</span>
                ${h.content ? `<div class="history-content">${this.renderHtml(h.content)}</div>` : ''}
              </div>
            `).join('')}
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
    .status { display: block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; padding: 2px 10px; font-size: 0.85em; margin: 4px 0 0 0; margin-left: 0; width: max-content; }
    .priority { font-size: 0.85em; margin: 4px 0 0 0; margin-left: 0; }
    .dates { display: flex; gap: 20px; font-size: 0.85em; margin-top: 8px; }
    ul { padding-left: 20px; margin: 0; }
    li { margin-bottom: 4px; }
    p { margin: 0 0 8px 0; }
    .description { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
    .description p { margin: 0 0 8px 0; }
    .description img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }
    .comments { display: flex; flex-direction: column; gap: 12px; }
    .comment { background: var(--vscode-textBlockQuote-background); border-radius: 6px; padding: 10px 12px; }
    .comment-header { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85em; }
    .comment-author { font-weight: 600; color: var(--vscode-foreground); }
    .comment-date { color: var(--vscode-descriptionForeground); }
    .comment-content { white-space: pre-wrap; word-break: break-word; }
    .history { display: flex; flex-direction: column; gap: 8px; }
    .history-item { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .history-icon { font-size: 0.9em; }
    .history-text { color: var(--vscode-foreground); }
    .history-date { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .history-content { width: 100%; padding-left: 20px; margin-top: 2px; white-space: pre-wrap; }
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
  </style>
</head>
<body>
  <h1 class="card-title" id="card-title" ondblclick="window.startEditTitle()">${this.escape(card.title)}</h1>
  <input type="text" id="title-input" class="card-title-input" style="display:none;" value="${this.escape(card.title)}">
  <span class="save-hint">Enter para guardar | Esc para cancelar</span>
  <div class="status">${this.escape(card.status_label)}</div>
  <div class="priority">${PRIORITY_LABELS[card.priority] ?? card.priority}</div>
  ${dates}
  <div class="labels">${labels}</div>
  ${card.description ? `<section><h3>Descrição</h3><div class="description" id="desc">${this.renderDescriptionWithImages(card.description)}</div></section>` : ''}
  ${members}
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
    // Receber mensagens da extensão
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.command === 'updateCardTitleSuccess') {
        window.updateCardTitleSuccess(msg.title);
      }
    });
  </script>
  <script>
    window.cardId = ${card.id};
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
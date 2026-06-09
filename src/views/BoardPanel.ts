import * as vscode from 'vscode';
import { boardsClient } from '../api/boardsClient';

export class BoardPanel {
  public static currentPanel: BoardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposalCallback: () => void;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.disposalCallback = () => {
      BoardPanel.currentPanel = undefined;
    };

    panel.onDidDispose(this.disposalCallback);

    panel.webview.html = this.getHtml();

    panel.webview.onDidReceiveMessage(async (msg) => {
      const { id, type, projectId, cardId, columnId } = msg;

      if (type === 'requestProjects') {
        try {
          const projects = await boardsClient.getProjects();
          this.panel.webview.postMessage({ id, type: 'projects', projects });
        } catch (err: unknown) {
          this.panel.webview.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (type === 'getProjectCards') {
        try {
          const data = await boardsClient.getProjectCards(projectId);
          this.panel.webview.postMessage({ id, type: 'projectCards', data });
        } catch (err: unknown) {
          this.panel.webview.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (type === 'moveCard') {
        try {
          await boardsClient.updateCard(cardId, { columnId });
          this.panel.webview.postMessage({ id, type: 'cardMoved' });
        } catch (err: unknown) {
          this.panel.webview.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    });
  }

  static show(extensionUri: vscode.Uri): void {
    if (BoardPanel.currentPanel) {
      BoardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'anturio.board',
      'Anturio Board',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    BoardPanel.currentPanel = new BoardPanel(panel, extensionUri);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Anturio Board</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1e1e1e; color: #ccc; padding: 16px; overflow-x: auto; }
    .board { display: flex; gap: 16px; min-height: 80vh; }
    .column { background: #252526; border-radius: 8px; width: 280px; min-width: 280px; display: flex; flex-direction: column; max-height: 85vh; }
    .column-header { padding: 12px; font-weight: 600; border-bottom: 1px solid #3c3c3c; display: flex; justify-content: space-between; align-items: center; }
    .column-count { background: #3c3c3c; border-radius: 10px; padding: 2px 8px; font-size: 12px; }
    .cards-container { padding: 8px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .card { background: #2d2d30; border-radius: 6px; padding: 10px 12px; cursor: grab; transition: all 0.2s; border: 1px solid transparent; }
    .card:hover { border-color: #007acc; background: #2a2d2e; }
    .card.dragging { opacity: 0.5; cursor: grabbing; }
    .card.drag-over { border-color: #007acc; background: #1a3a4a; }
    .card-title { font-size: 14px; margin-bottom: 6px; }
    .card-meta { font-size: 11px; color: #888; display: flex; gap: 10px; }
    .card-meta span { display: flex; align-items: center; gap: 3px; }
    .priority-urgent { border-left: 3px solid #f14c4c; }
    .priority-high { border-left: 3px solid #cca700; }
    .priority-medium { border-left: 3px solid #007acc; }
    .priority-low { border-left: 3px solid #4ec9b0; }
    .loading { text-align: center; padding: 40px; color: #888; }
    .error { color: #f14c4c; text-align: center; padding: 20px; }
    .project-selector { margin-bottom: 16px; }
    .project-selector select { width: 100%; padding: 10px; background: #2d2d30; color: #ccc; border: 1px solid #3c3c3c; border-radius: 6px; font-size: 14px; }
    .empty-column { text-align: center; padding: 20px; color: #555; font-size: 13px; }
    .refresh-btn { background: #007acc; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-bottom: 16px; }
    .refresh-btn:hover { background: #005a9e; }
  </style>
</head>
<body>
  <button class="refresh-btn" onclick="loadBoard()">🔄 Atualizar</button>
  <div class="project-selector">
    <select id="projectSelect" onchange="loadBoard()">
      <option value="">Seleciona um projeto...</option>
    </select>
  </div>
  <div class="board" id="board"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const pendingRequests = new Map();

    function sendRequest(type, data) {
      return new Promise((resolve, reject) => {
        const id = Date.now() + Math.random();
        pendingRequests.set(id, { resolve, reject });
        vscode.postMessage({ id, type, ...data });
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error('Timeout'));
          }
        }, 30000);
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'projects') {
        const select = document.getElementById('projectSelect');
        select.innerHTML = '<option value="">Seleciona um projeto...</option>' +
          msg.projects.map(p => \`<option value="\${p.id}">\${p.title}</option>\`).join('');
      }
      if (msg.type === 'projectCards') {
        const req = pendingRequests.get(msg.id);
        if (req) { req.resolve(msg.data); pendingRequests.delete(msg.id); }
      }
      if (msg.type === 'cardMoved') {
        const req = pendingRequests.get(msg.id);
        if (req) { req.resolve(); pendingRequests.delete(msg.id); }
      }
      if (msg.type === 'error') {
        const req = pendingRequests.get(msg.id);
        if (req) { req.reject(new Error(msg.message)); pendingRequests.delete(msg.id); }
      }
    });

    async function loadBoard() {
      const projectId = document.getElementById('projectSelect').value;
      if (!projectId) {
        document.getElementById('board').innerHTML = '<div class="loading">Seleciona um projeto para ver o board.</div>';
        return;
      }
      document.getElementById('board').innerHTML = '<div class="loading">A carregar...</div>';
      try {
        const data = await sendRequest('getProjectCards', { projectId: parseInt(projectId) });
        renderBoard(data);
      } catch (err) {
        document.getElementById('board').innerHTML = '<div class="error">Erro ao carregar: ' + err.message + '</div>';
      }
    }

    function renderBoard(data) {
      const board = document.getElementById('board');
      if (!data.cards || data.cards.length === 0) {
        board.innerHTML = '<div class="loading">Este projeto ainda não tem colunas ou cartões.</div>';
        return;
      }

      board.innerHTML = data.columns.map(col => {
        const colCards = data.cards.filter(c => c.status === col.id);
        return \`
          <div class="column" data-column-id="\${col.id}">
            <div class="column-header">
              <span>\${col.title}</span>
              <span class="column-count">\${colCards.length}</span>
            </div>
            <div class="cards-container" data-column-id="\${col.id}"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event)">
              \${colCards.length === 0 ? '<div class="empty-column">Arrasta cartões para aqui</div>' : ''}
              \${colCards.map(card => renderCard(card)).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderCard(card) {
      const priorityClass = 'priority-' + (card.priority || 'low');
      const dueDate = card.due_date ? new Date(card.due_date).toLocaleDateString('pt-PT') : '';
      const priorityLabel = { urgent: '🔴', high: '🟡', medium: '🔵', low: '🟢' }[card.priority || 'low'];

      return \`
        <div class="card \${priorityClass}" draggable="true" data-card-id="\${card.id}"
             ondragstart="handleDragStart(event)"
             ondragend="handleDragEnd(event)">
          <div class="card-title">\${card.title}</div>
          <div class="card-meta">
            \${priorityLabel ? '<span>' + priorityLabel + '</span>' : ''}
            \${dueDate ? '<span>📅 ' + dueDate + '</span>' : ''}
          </div>
        </div>
      \`;
    }

    function handleDragStart(event) {
      event.target.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', event.target.dataset.cardId);
    }

    function handleDragEnd(event) {
      event.target.classList.remove('dragging');
      document.querySelectorAll('.card.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function handleDragOver(event) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const container = event.target.closest('.cards-container');
      if (container) { container.classList.add('drag-over'); }
    }

    function handleDragLeave(event) {
      const container = event.target.closest('.cards-container');
      if (container && !container.contains(event.relatedTarget)) {
        container.classList.remove('drag-over');
      }
    }

    function handleDrop(event) {
      event.preventDefault();
      const cardId = event.dataTransfer.getData('text/plain');
      const targetContainer = event.target.closest('.cards-container');
      if (!targetContainer || !cardId) { return; }

      const newColumnId = targetContainer.dataset.columnId;
      const cardElement = document.querySelector(\`[data-card-id="\${cardId}"]\`);
      if (!cardElement) { return; }

      targetContainer.appendChild(cardElement);
      const emptyMsg = targetContainer.querySelector('.empty-column');
      if (emptyMsg) { emptyMsg.remove(); }

      document.querySelectorAll('.cards-container').forEach(c => {
        if (c.children.length === 0) {
          c.innerHTML = '<div class="empty-column">Arrasta cartões para aqui</div>';
        }
      });

      updateColumnCounts();
      sendRequest('moveCard', { cardId: parseInt(cardId), columnId: newColumnId });
    }

    function updateColumnCounts() {
      document.querySelectorAll('.column').forEach(col => {
        const count = col.querySelectorAll('.card').length;
        const countEl = col.querySelector('.column-count');
        if (countEl) { countEl.textContent = count; }
      });
    }

    vscode.postMessage({ type: 'requestProjects' });
  </script>
</body>
</html>`;
  }
}

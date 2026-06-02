import * as vscode from 'vscode';
import { Card } from '../api/boardsClient';

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '🔴 Urgente',
  high: '🟠 Alta',
  medium: '🟡 Média',
  low: '🟢 Baixa',
};

export class CardDetailPanel {
  private static panels = new Map<number, CardDetailPanel>();
  private readonly panel: vscode.WebviewPanel;

  private constructor(card: Card) {
    this.panel = vscode.window.createWebviewPanel(
      'anturio.cardDetail',
      card.title,
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.buildHtml(card);
    this.panel.onDidDispose(() => CardDetailPanel.panels.delete(card.id));
  }

  static show(card: Card): void {
    if (CardDetailPanel.panels.has(card.id)) {
      CardDetailPanel.panels.get(card.id)!.panel.reveal();
      return;
    }
    CardDetailPanel.panels.set(card.id, new CardDetailPanel(card));
  }

  private buildHtml(card: Card): string {
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

    return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escape(card.title)}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; line-height: 1.6; max-width: 600px; }
    h1 { font-size: 1.3em; margin-bottom: 6px; }
    h3 { font-size: 0.9em; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
    section { margin-top: 20px; border-top: 1px solid var(--vscode-panel-border); padding-top: 16px; }
    .label { border-radius: 4px; padding: 2px 8px; font-size: 0.8em; margin-right: 6px; color: #fff; }
    .labels { margin: 10px 0; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .priority { font-size: 0.85em; margin: 4px 0; }
    .status { display: inline-block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; padding: 2px 10px; font-size: 0.85em; margin: 4px 0; }
    .dates { display: flex; gap: 20px; font-size: 0.85em; margin-top: 8px; }
    ul { padding-left: 20px; margin: 0; }
    li { margin-bottom: 4px; }
    p { margin: 0; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${this.escape(card.title)}</h1>
  <div class="status">${this.escape(card.status_label)}</div>
  <div class="priority">${PRIORITY_LABELS[card.priority] ?? card.priority}</div>
  ${dates}
  <div class="labels">${labels}</div>
  ${card.description ? `<section><h3>Descrição</h3><p>${this.escape(card.description)}</p></section>` : ''}
  ${members}
</body>
</html>`;
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

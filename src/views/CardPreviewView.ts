import * as vscode from 'vscode';
import { Card } from '../api/boardsClient';
import { CardDetailPanel } from './CardDetailPanel';

export class CardPreviewView implements vscode.WebviewViewProvider {
  private static _currentCard: Card | null = null;
  private static _view: vscode.WebviewView | undefined;
  private static _currentAdapter: any = null;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  static register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('anturio.cardPreview', new CardPreviewView(context), {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  static setCard(card: Card | null): void {
    CardPreviewView._currentCard = card;
    if (!card) {
      CardPreviewView._currentAdapter = null;
      if (CardPreviewView._view) {
        CardPreviewView._view.webview.html = CardPreviewView.buildEmptyHtml();
      }
      return;
    }

    if (CardPreviewView._view) {
      CardPreviewView._view.show(true);

      const adapter = Object.create(CardDetailPanel.prototype);
      adapter.card = card;
      adapter.currentUser = null;
      adapter.projectParticipants = [];
      adapter.isPreview = true;
      adapter.panel = {
        webview: CardPreviewView._view.webview,
        set title(val: string) {
          if (CardPreviewView._view) CardPreviewView._view.title = val;
        },
        get title() {
          return CardPreviewView._view?.title || '';
        },
        postMessage(message: any) {
          return CardPreviewView._view?.webview.postMessage(message);
        },
        reveal() {
          CardPreviewView._view?.show(true);
        }
      };

      CardPreviewView._currentAdapter = adapter;
      adapter.loadCardDetails(card.id, card);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void {
    CardPreviewView._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      console.log('[CardPreviewView] Received message:', message.command);
      if (CardPreviewView._currentAdapter) {
        try {
          await CardPreviewView._currentAdapter.handleMessage(message);
        } catch (err) {
          console.error('[CardPreviewView] Error handling message:', err);
        }
      }
    });

    if (CardPreviewView._currentCard) {
      CardPreviewView.setCard(CardPreviewView._currentCard);
    } else {
      webviewView.webview.html = CardPreviewView.buildEmptyHtml();
    }
  }

  private static buildEmptyHtml(): string {
    return `<!DOCTYPE html><html><head><style>
      body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
      .empty { color: var(--vscode-disabledForeground); text-align: center; margin-top: 40px; }
    </style></head><body><div class="empty">Nenhum cartão aberto</div></body></html>`;
  }
}
import * as vscode from 'vscode';
import { boardsClient } from './api/boardsClient';
import { BoardsProvider } from './views/BoardsProvider';
import { CardDetailPanel } from './views/CardDetailPanel';
import { createCardCommand, createCardFromSelectionCommand } from './commands/createCard';
import { linkCommitCommand, setupGitPostCommitHook } from './commands/linkCommit';
import { aiSuggestCardCommand } from './ai/aiAssistant';
import { Card } from './api/boardsClient';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new BoardsProvider();

  await updateAuthContext();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('anturio.apiKey') || e.affectsConfiguration('anturio.serverUrl')) {
        updateAuthContext().then(() => provider.refresh());
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('anturio.projectsView', provider),
    vscode.window.registerTreeDataProvider('anturio.welcomeView', provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('anturio.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('anturio.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'anturio'),
    ),

    vscode.commands.registerCommand('anturio.openDashboard', () => {
      const serverUrl = vscode.workspace.getConfiguration('anturio').get<string>('serverUrl', '');
      if (serverUrl) {
        vscode.env.openExternal(vscode.Uri.parse(serverUrl));
      } else {
        vscode.window.showWarningMessage('Configura o URL do servidor Anturio nas definições primeiro.');
      }
    }),

    vscode.commands.registerCommand('anturio.createCard', createCardCommand),
    vscode.commands.registerCommand('anturio.createCardFromSelection', createCardFromSelectionCommand),
    vscode.commands.registerCommand('anturio.linkCommit', () => linkCommitCommand()),
    vscode.commands.registerCommand('anturio.aiSuggestCard', aiSuggestCardCommand),

    vscode.commands.registerCommand('anturio.openCard', (card: Card) => {
      CardDetailPanel.show(card);
    }),

    vscode.commands.registerCommand('anturio.viewCardDetails', (item) => {
      if (item?.data) CardDetailPanel.show(item.data as Card);
    }),

    vscode.commands.registerCommand('anturio.signOut', async () => {
      await vscode.workspace
        .getConfiguration('anturio')
        .update('apiKey', '', vscode.ConfigurationTarget.Global);
      await updateAuthContext();
      provider.refresh();
      vscode.window.showInformationMessage('Sessão do Anturio terminada.');
    }),
  );

  setupGitPostCommitHook(context);
  setupAutoRefresh(context, provider);

  if (boardsClient.isConfigured()) {
    provider.refresh();
  }
}

function setupAutoRefresh(context: vscode.ExtensionContext, provider: BoardsProvider): void {
  const config = vscode.workspace.getConfiguration('anturio');
  const minutes = config.get<number>('autoRefreshMinutes', 5);
  if (minutes <= 0) return;

  const interval = setInterval(() => {
    if (boardsClient.isConfigured()) provider.refresh();
  }, minutes * 60 * 1000);

  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

async function updateAuthContext(): Promise<void> {
  const isAuthenticated = boardsClient.isConfigured() && (await boardsClient.validateApiKey());
  vscode.commands.executeCommand('setContext', 'anturio.authenticated', isAuthenticated);
}

export function deactivate(): void {}

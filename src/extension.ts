import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { boardsClient } from './api/boardsClient';
import { BoardsProvider } from './views/BoardsProvider';
import { CardDetailPanel } from './views/CardDetailPanel';
import { createCardCommand, createCardFromSelectionCommand } from './commands/createCard';
import { linkCommitCommand, setupGitPostCommitHook } from './commands/linkCommit';
import { aiSuggestCardCommand } from './ai/aiAssistant';
import { Card } from './api/boardsClient';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new BoardsProvider();

  const authenticated = await updateAuthContext();
  if (authenticated) {
    await setupMcpConfig(context);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('anturio.apiKey') || e.affectsConfiguration('anturio.serverUrl')) {
        const ok = await updateAuthContext();
        provider.refresh();
        if (ok) await setupMcpConfig(context);
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
      removeMcpConfig();
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

async function setupMcpConfig(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('anturio');
  const apiKey = config.get<string>('apiKey', '');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000');

  const mcpServerPath = path.join(context.extensionPath, '..', 'mcp-server', 'dist', 'index.js');

  if (!fs.existsSync(mcpServerPath)) return;

  const mcpEntry = {
    command: 'node',
    args: [mcpServerPath],
    env: {
      ANTURIO_API_KEY: apiKey,
      ANTURIO_SERVER_URL: serverUrl,
    },
  };

  // Escreve na config global do Claude Code
  writeMcpToFile(path.join(os.homedir(), '.claude', 'settings.json'), mcpEntry);

  // Escreve também na config do Cursor
  writeMcpToFile(path.join(os.homedir(), '.cursor', 'mcp.json'), mcpEntry, 'cursor');

  // Escreve na config do projeto VS Code (se houver workspace aberto)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const projectClaude = path.join(workspaceFolders[0].uri.fsPath, '.claude', 'settings.json');
    writeMcpToFile(projectClaude, mcpEntry);
  }
}

function writeMcpToFile(
  filePath: string,
  mcpEntry: object,
  format: 'claude' | 'cursor' = 'claude',
): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {}

    if (format === 'cursor') {
      if (!settings.mcpServers) settings.mcpServers = {};
      (settings.mcpServers as Record<string, unknown>)['anturio-boards'] = mcpEntry;
    } else {
      if (!settings.mcpServers) settings.mcpServers = {};
      (settings.mcpServers as Record<string, unknown>)['anturio-boards'] = mcpEntry;
    }

    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {
    // Silencioso — se não tiver permissão para escrever, não quebra a extensão
  }
}

function removeMcpConfig(): void {
  const targets = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.cursor', 'mcp.json'),
  ];

  for (const filePath of targets) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      if (settings.mcpServers) {
        delete (settings.mcpServers as Record<string, unknown>)['anturio-boards'];
      }
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch {}
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

async function updateAuthContext(): Promise<boolean> {
  const isAuthenticated = boardsClient.isConfigured() && (await boardsClient.validateApiKey());
  vscode.commands.executeCommand('setContext', 'anturio.authenticated', isAuthenticated);
  return isAuthenticated;
}

export function deactivate(): void {}

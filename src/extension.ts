import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { boardsClient } from './api/boardsClient';
import { BoardsProvider } from './views/BoardsProvider';
import { CardDetailPanel } from './views/CardDetailPanel';
import { BoardPanel } from './views/BoardPanel';
import { CardPreviewView } from './views/CardPreviewView';
import { createCardCommand, createCardFromSelectionCommand, createCardInColumnCommand } from './commands/createCard';
import { linkCommitCommand, setupGitPostCommitHook } from './commands/linkCommit';
import { aiSuggestCardCommand } from './ai/aiAssistant';
import { startMcpHttpCommand, stopMcpHttpCommand, getTunnelUrl } from './commands/mcpProxy';
import { moveCardCommand } from './commands/moveCard';
import { editCardCommand } from './commands/editCard';
import { deleteCardCommand } from './commands/deleteCard';
import { archiveCardCommand } from './commands/archiveCard';
import { Card } from './api/boardsClient';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[Anturio] Extension activating...');

  // Track clicks for double-click detection
  let lastOpenTime = 0;
  let lastOpenCardId = 0;

  const provider = new BoardsProvider();

  const projectsView = vscode.window.createTreeView('anturio.projectsView', {
    treeDataProvider: provider,
    dragAndDropController: provider.dragAndDropController,
  });
  context.subscriptions.push(projectsView);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('anturio.welcomeView', provider),
  );

  // Register card preview webview
  CardPreviewView.register(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('anturio.apiKey') || e.affectsConfiguration('anturio.serverUrl')) {
        const ok = await updateAuthContext();
        provider.refresh();
        if (ok) {
          await setupMcpConfig(context);
          startMcpServer(context);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('anturio.refresh', () => {
      provider.refresh();
    }),

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
    vscode.commands.registerCommand('anturio.createCardInColumn', (_item: { data: any; projectId?: number }) => {
      if (_item?.data) {
        const column = _item.data;
        const projectId = _item.projectId;
        if (projectId) createCardInColumnCommand(projectId, column.id);
      }
    }),
    vscode.commands.registerCommand('anturio.linkCommit', () => linkCommitCommand()),
    vscode.commands.registerCommand('anturio.aiSuggestCard', aiSuggestCardCommand),

    vscode.commands.registerCommand('anturio.openCard', async (card: Card) => {
      const now = Date.now();
      if (now - lastOpenTime < 400 && lastOpenCardId === card.id) {
        // Double click - edit title
        lastOpenTime = 0;
        lastOpenCardId = 0;
        if (!boardsClient.isConfigured()) {
          vscode.window.showErrorMessage('Anturio: API Key não configurada.');
          return;
        }
        const newTitle = await vscode.window.showInputBox({
          prompt: 'Novo título do card',
          value: card.title,
          ignoreFocusOut: true,
        });
        if (!newTitle || newTitle === card.title) return;
        try {
          await boardsClient.updateCard(card.id, { title: newTitle });
          vscode.window.showInformationMessage(`Título alterado para "${newTitle}"`);
          vscode.commands.executeCommand('anturio.refresh');
        } catch (err) {
          vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        }
      } else {
        // Single click - open panel
        lastOpenTime = now;
        lastOpenCardId = card.id;
        CardDetailPanel.show(card);
        CardPreviewView.setCard(card);
      }
    }),

    vscode.commands.registerCommand('anturio.viewCardDetails', (item) => {
      // Handle both direct Card and TreeItem with Card data
      const card = (item as any)?.data?.id ? (item as any).data as Card : item as Card;
      if (card?.id) {
        CardDetailPanel.show(card);
        CardPreviewView.setCard(card);
      }
    }),

    vscode.commands.registerCommand('anturio.viewCardDetailsSidebar', async (item) => {
      // Handle both direct Card and TreeItem with Card data
      const card = (item as any)?.data?.id ? (item as any).data as Card : item as Card;
      if (card?.id) {
        console.log('[Extension] Opening sidebar for card:', card.id, card.title);
        // Check if sidebar already exists
        if (!CardDetailPanel.hasSidebar()) {
          console.log('[Extension] Creating new split');
          // First time: create split editor
          await vscode.commands.executeCommand('workbench.action.splitEditor');
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          console.log('[Extension] Reusing existing sidebar');
        }
        // Then open in Two (if first time) or reuse sidebar
        CardDetailPanel.showInTwo(card);
        CardPreviewView.setCard(card);
      }
    }),

    vscode.commands.registerCommand('anturio.moveCard', (item) => {
      if (item?.data) moveCardCommand(item.data as Card);
    }),

    vscode.commands.registerCommand('anturio.editCard', (item) => {
      if (item?.data) editCardCommand(item.data as Card, item.projectId);
    }),

    vscode.commands.registerCommand('anturio.deleteCard', async (item) => {
      if (item?.data) await deleteCardCommand(item.data as Card);
    }),

    vscode.commands.registerCommand('anturio.archiveCard', (item) => {
      if (item?.data) archiveCardCommand(item.data as Card);
    }),

    vscode.commands.registerCommand('anturio.signOut', async () => {
      await vscode.workspace
        .getConfiguration('anturio')
        .update('apiKey', '', vscode.ConfigurationTarget.Global);
      removeMcpConfig();
      mcpProcess?.kill();
      mcpProcess = null;
      await updateAuthContext();
      provider.refresh();
      vscode.window.showInformationMessage('Sessão do Anturio terminada.');
    }),

    vscode.commands.registerCommand('anturio.startMcpHttp', () => startMcpHttpCommand()),
    vscode.commands.registerCommand('anturio.stopMcpHttp', () => stopMcpHttpCommand()),
    vscode.commands.registerCommand('anturio.getMcpUrl', async () => {
      const url = getTunnelUrl();
      if (url) {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(`URL: ${url} (copiada)`);
      } else {
        vscode.window.showWarningMessage('O túnel MCP não está ativo. Usa "Iniciar MCP HTTP" primeiro.');
      }
    }),

    vscode.commands.registerCommand('anturio.openBoard', () => {
      BoardPanel.show(context.extensionUri);
    }),

    vscode.commands.registerCommand('anturio.mcpStatus', async () => {
      const apiKey = vscode.workspace.getConfiguration('anturio').get<string>('apiKey', '');
      if (!apiKey) {
        vscode.window.showWarningMessage('API Key do Anturio não configurada.');
        return;
      }

      const parentMcpPath = path.join(context.extensionPath, '..', 'mcp-server', 'dist', 'index.js');
      const siblingMcpPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'index.js');
      const mcpServerPath = fs.existsSync(parentMcpPath)
        ? parentMcpPath
        : fs.existsSync(siblingMcpPath)
          ? siblingMcpPath
          : null;

      const statusLines: string[] = [];
      statusLines.push('**Estado do Servidor MCP do Anturio Boards**\n');

      if (!mcpServerPath) {
        statusLines.push('❌ Servidor MCP não encontrado');
        statusLines.push(`   Procurado em: ${parentMcpPath}`);
        statusLines.push(`   E em: ${siblingMcpPath}`);
      } else {
        statusLines.push(`✅ Servidor MCP encontrado: ${mcpServerPath}`);
      }

      statusLines.push(`\n**Processo:** ${mcpProcess ? '✅ A correr' : '❌ Parado'}`);
      statusLines.push(`**API Key:** ${apiKey ? '✅ Configurada' : '❌ Não configurada'}`);

      const claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
      const claudeConfigExists = fs.existsSync(claudeConfigPath);
      statusLines.push(`**Configuração Claude Code:** ${claudeConfigExists ? '✅ Existe' : '⚠️ Não existe'}`);

      if (claudeConfigExists) {
        try {
          const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
          const hasMcpEntry = claudeConfig.mcpServers?.['anturio-boards'];
          statusLines.push(`**Entrada MCP no Claude Code:** ${hasMcpEntry ? '✅ Configurada' : '⚠️ Não configurada'}`);
        } catch {}
      }

      const message = statusLines.join('\n');
      const action = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        'Reiniciar Servidor',
        'Ver Logs',
        'Fechar'
      );

      if (action === 'Reiniciar Servidor') {
        if (mcpProcess) {
          mcpProcess.kill();
          mcpProcess = null;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (mcpServerPath) {
          await setupMcpConfig(context);
          startMcpServer(context);
          vscode.window.showInformationMessage('Servidor MCP reiniciado.');
        } else {
          vscode.window.showErrorMessage('Não é possível reiniciar: servidor MCP não encontrado.');
        }
      } else if (action === 'Ver Logs') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    }),
  );

  setupGitPostCommitHook(context);
  setupAutoRefresh(context, provider);

  // Auth check runs async so it never blocks command registration
  updateAuthContext().then(async (authenticated) => {
    console.log('[Anturio] Authenticated:', authenticated);
    if (authenticated) {
      console.log('[Anturio] Starting MCP server...');
      await setupMcpConfig(context);
      startMcpServer(context);
      provider.refresh();
    }
  });
}

async function setupMcpConfig(context: vscode.ExtensionContext): Promise<{ mcpServerPath: string; mcpEntry: object } | null> {
  const config = vscode.workspace.getConfiguration('anturio');
  const apiKey = config.get<string>('apiKey', '');
  const serverUrl = config.get<string>('serverUrl', 'https://boards.anturio.app');

  // Use same logic as startMcpServer() to find the server
  const parentMcpPath = path.join(context.extensionPath, '..', 'mcp-server', 'dist', 'index.js');
  const siblingMcpPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'index.js');

  const mcpServerPath = fs.existsSync(parentMcpPath)
    ? parentMcpPath
    : fs.existsSync(siblingMcpPath)
      ? siblingMcpPath
      : null;

  if (!mcpServerPath) {
    console.error('[Anturio] MCP server not found at:', parentMcpPath, 'or', siblingMcpPath);
    return null;
  }

  console.log('[Anturio] MCP server found at:', mcpServerPath);

  const mcpEntry = {
    command: 'node',
    args: [mcpServerPath],
    env: {
      ANTURIO_API_KEY: apiKey,
      ANTURIO_SERVER_URL: serverUrl,
      TRANSPORT: 'stdio',
    },
  };

  // Escreve na config global do Claude Code
  const claudeGlobalPath = path.join(os.homedir(), '.claude', 'settings.json');
  writeMcpToFile(claudeGlobalPath, mcpEntry);

  // Escreve também na config do Cursor
  const cursorPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  writeMcpToFile(cursorPath, mcpEntry, 'cursor');

  // Escreve na config do projeto VS Code (se houver workspace aberto)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let projectClaudeDir = '';

  if (workspaceFolders && workspaceFolders.length > 0) {
    projectClaudeDir = path.join(workspaceFolders[0].uri.fsPath, '.claude');
  } else {
    // Se não há workspace, tenta usar a pasta padrão do Anturio-Trello
    const defaultPath = path.join(os.homedir(), 'Documents', 'Anturio', 'Anturio-Trello', '.claude');
    if (fs.existsSync(path.join(os.homedir(), 'Documents', 'Anturio', 'Anturio-Trello'))) {
      projectClaudeDir = defaultPath;
    }
  }

  if (projectClaudeDir) {
    // Cria directório .claude se não existir
    if (!fs.existsSync(projectClaudeDir)) {
      fs.mkdirSync(projectClaudeDir, { recursive: true });
    }

    const projectClaude = path.join(projectClaudeDir, 'settings.json');
    writeMcpToFile(projectClaude, mcpEntry);

    console.log('[Anturio] MCP config written to:', projectClaude);
  }

  return { mcpServerPath, mcpEntry: { command: 'node', args: [mcpServerPath], env: { ANTURIO_API_KEY: apiKey, ANTURIO_SERVER_URL: serverUrl } } };
}

let mcpProcess: ChildProcess | null = null;

function startMcpServer(context: vscode.ExtensionContext): void {
  console.log('[MCP] extensionPath:', context.extensionPath);

  // Try parent first (for development where extensionPath is out/)
  const parentMcpPath = path.join(context.extensionPath, '..', 'mcp-server', 'dist', 'index.js');
  const siblingMcpPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'index.js');

  console.log('[MCP] Trying paths:', parentMcpPath, siblingMcpPath);
  console.log('[MCP] Parent exists:', fs.existsSync(parentMcpPath));
  console.log('[MCP] Sibling exists:', fs.existsSync(siblingMcpPath));

  const mcpServerPath = fs.existsSync(parentMcpPath)
    ? parentMcpPath
    : fs.existsSync(siblingMcpPath)
      ? siblingMcpPath
      : null;

  if (!mcpServerPath) {
    console.error('[MCP] Could not find mcp-server at:', parentMcpPath, 'or', siblingMcpPath);
    vscode.window.showWarningMessage(
      'Servidor MCP do Anturio Boards não encontrado. A integração com Claude Code não estará disponível.',
      'Ver Logs'
    ).then(action => {
      if (action === 'Ver Logs') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    });
    return;
  }

  console.log('[MCP] Found server at:', mcpServerPath);

  const config = vscode.workspace.getConfiguration('anturio');
  const apiKey = config.get<string>('apiKey', '');
  const serverUrl = config.get<string>('serverUrl', 'https://boards.anturio.app');

  if (!apiKey) {
    console.warn('[MCP] API Key not configured, skipping server start');
    return;
  }

  // Se já houver um processo, mata
  if (mcpProcess) {
    console.log('[MCP] Killing existing process');
    mcpProcess.kill();
    mcpProcess = null;
  }

  console.log('[MCP] Starting server with stdio transport...');

  mcpProcess = spawn('node', [mcpServerPath], {
    env: {
      ...process.env,
      ANTURIO_API_KEY: apiKey,
      ANTURIO_SERVER_URL: serverUrl,
      TRANSPORT: 'stdio',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverReady = false;

  mcpProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(`[MCP] ${msg}`);
      if (msg.includes('[MCP] Servidor stdio conectado e pronto')) {
        serverReady = true;
        console.log('[MCP] Server confirmed ready');
      }
    }
  });

  mcpProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    console.error(`[MCP Error] ${msg}`);
    if (msg.includes('ERRO')) {
      vscode.window.showErrorMessage(`Anturio MCP: ${msg.replace(/\[MCP.*?\]/g, '').trim()}`);
    }
  });

  mcpProcess.on('error', (err) => {
    console.error(`[MCP Process Error] ${err.message}`);
    vscode.window.showErrorMessage(
      `Erro ao iniciar servidor MCP do Anturio: ${err.message}`,
      'Ver Logs'
    ).then(action => {
      if (action === 'Ver Logs') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    });
  });

  mcpProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[MCP] Process exited with code ${code}`);
      if (!serverReady) {
        vscode.window.showErrorMessage(
          `Servidor MCP do Anturio terminou inesperadamente (código: ${code})`,
          'Ver Logs'
        ).then(action => {
          if (action === 'Ver Logs') {
            vscode.commands.executeCommand('workbench.action.output.toggleOutput');
          }
        });
      }
    }
    mcpProcess = null;
  });

  context.subscriptions.push({ dispose: () => mcpProcess?.kill() });
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

    // Para Claude Code: usa a chave "mcpServers" directamente
    // Para Cursor: usa a chave "mcpServers" mas com estrutura diferente
    if (!settings.mcpServers) settings.mcpServers = {};
    (settings.mcpServers as Record<string, unknown>)['anturio-boards'] = mcpEntry;

    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[Anturio] MCP config written to:', filePath);
  } catch (err) {
    console.error('[Anturio] Error writing MCP config:', err);
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

export function deactivate(): void {
  mcpProcess?.kill();
}

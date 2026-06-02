import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { boardsClient, Card } from '../api/boardsClient';

function getRecentCommits(cwd: string): Array<{ hash: string; message: string }> {
  try {
    const output = execSync('git log --oneline -20', { cwd, encoding: 'utf-8' });
    return output
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, ...rest] = line.split(' ');
        return { hash, message: rest.join(' ') };
      });
  } catch {
    return [];
  }
}

function getLatestCommitHash(cwd: string): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function linkCommitCommand(preselectedCard?: Card): Promise<void> {
  if (!boardsClient.isConfigured()) {
    const action = await vscode.window.showErrorMessage(
      'Configura a API Key do Anturio primeiro.',
      'Abrir Definições',
    );
    if (action) vscode.commands.executeCommand('anturio.openSettings');
    return;
  }

  const cwd = getWorkspacePath();
  if (!cwd) {
    vscode.window.showWarningMessage('Abre uma pasta de trabalho para usar esta funcionalidade.');
    return;
  }

  const commits = getRecentCommits(cwd);
  if (commits.length === 0) {
    vscode.window.showWarningMessage('Não encontrámos commits git neste workspace.');
    return;
  }

  const commitItem = await vscode.window.showQuickPick(
    commits.map((c) => ({ label: c.message, description: c.hash, hash: c.hash })),
    { placeHolder: 'Seleciona o commit a associar' },
  );
  if (!commitItem) return;

  let card = preselectedCard;

  if (!card) {
    let projects;
    try {
      projects = await boardsClient.getProjects();
    } catch (err) {
      vscode.window.showErrorMessage(`Erro ao carregar projetos: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const projectItem = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.title, description: p.workspace_name, project: p })),
      { placeHolder: 'Seleciona o projeto' },
    );
    if (!projectItem) return;

    let cards: Card[];
    try {
      const data = await boardsClient.getProjectCards(projectItem.project.id);
      cards = data.cards;
    } catch (err) {
      vscode.window.showErrorMessage(`Erro ao carregar cards: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (cards.length === 0) {
      vscode.window.showWarningMessage('Este projeto não tem cards.');
      return;
    }

    const cardItem = await vscode.window.showQuickPick(
      cards.map((c) => ({ label: c.title, description: c.status_label, card: c })),
      { placeHolder: 'Seleciona o card a associar ao commit' },
    );
    if (!cardItem) return;
    card = cardItem.card;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Associando commit...' },
    async () => {
      try {
        await boardsClient.linkCommitToCard(card!.id, commitItem.hash);
        vscode.window.showInformationMessage(
          `Commit ${commitItem.hash.slice(0, 8)} associado a "${card!.title}"`,
        );
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Erro ao associar commit: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

export function setupGitPostCommitHook(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('anturio');
  if (!config.get<boolean>('git.autoLink', false)) return;

  const watcher = vscode.workspace.createFileSystemWatcher('**/.git/COMMIT_EDITMSG');
  context.subscriptions.push(watcher);

  watcher.onDidChange(async () => {
    if (!boardsClient.isConfigured()) return;
    const cwd = getWorkspacePath();
    if (!cwd) return;

    const hash = getLatestCommitHash(cwd);
    if (!hash) return;

    const action = await vscode.window.showInformationMessage(
      `Novo commit (${hash.slice(0, 8)}). Associar a um card do Anturio?`,
      'Sim',
      'Não',
      'Não mostrar mais',
    );

    if (action === 'Sim') {
      await linkCommitCommand();
    } else if (action === 'Não mostrar mais') {
      config.update('git.autoLink', false, vscode.ConfigurationTarget.Workspace);
    }
  });
}

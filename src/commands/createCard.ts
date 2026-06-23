import * as vscode from 'vscode';
import { boardsClient, Project, Column, Card, CreateCardPayload } from '../api/boardsClient';

async function pickProjectAndColumn(): Promise<{ project: Project; column?: Column } | undefined> {
  let projects: Project[];
  try {
    projects = await boardsClient.getProjects();
  } catch (err) {
    vscode.window.showErrorMessage(`Erro ao carregar projetos: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }

  if (projects.length === 0) {
    vscode.window.showWarningMessage('Não tens projetos no Anturio. Cria um no painel.');
    return undefined;
  }

  const projectItem = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.title, description: p.workspace_name, project: p })),
    { placeHolder: 'Seleciona o projeto' },
  );
  if (!projectItem) return undefined;

  const project = projectItem.project;

  let columns: Column[];
  try {
    const data = await boardsClient.getProjectCards(project.id);
    columns = data.columns;
  } catch {
    return { project };
  }

  if (columns.length === 0) return { project };

  const colItem = await vscode.window.showQuickPick(
    [
      { label: `$(arrow-right) Primeira coluna por defeito`, description: '', column: undefined },
      ...columns.map((c) => ({ label: c.title, description: c.id, column: c })),
    ],
    { placeHolder: 'Seleciona a coluna (opcional)' },
  );
  if (!colItem) return undefined;

  return { project, column: colItem.column };
}

export async function createCardCommand(): Promise<void> {
  if (!boardsClient.isConfigured()) {
    const action = await vscode.window.showErrorMessage(
      'Configura a API Key do Anturio primeiro.',
      'Abrir Definições',
    );
    if (action) vscode.commands.executeCommand('anturio.openSettings');
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Título do card',
    placeHolder: 'Ex: Corrigir bug no botão de login',
  });
  if (!title) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Descrição (opcional)',
    placeHolder: 'Descreve a tarefa...',
  });

  const priorityItem = await vscode.window.showQuickPick(
    [
      { label: '🔵 Baixa', value: 'low' as const },
      { label: '🟢 Normal', value: 'normal' as const },
      { label: '🟠 Alta', value: 'high' as const },
      { label: '🔴 Crítica', value: 'critical' as const },
    ],
    { placeHolder: 'Prioridade' },
  );
  if (!priorityItem) return;

  const picked = await pickProjectAndColumn();
  if (!picked) return;

  const payload: CreateCardPayload = {
    title,
    description: description || undefined,
    columnId: picked.column?.id,
    priority: priorityItem.value,
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Criando card...' },
    async () => {
      try {
        const card = await boardsClient.createCard(picked.project.id, payload);
        const action = await vscode.window.showInformationMessage(
          `Card "${card.title}" criado em ${card.status_label}`,
          'Ver no Painel',
        );
        if (action) {
          const serverUrl = vscode.workspace.getConfiguration('anturio').get<string>('serverUrl', '');
          vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/projects/${picked.project.id}`));
        }
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Erro ao criar card: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

export async function createCardInColumnCommand(projectId: number, columnId: string): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Configura a API Key do Anturio primeiro.');
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Título do card',
    placeHolder: 'Ex: Corrigir bug no botão de login',
  });
  if (!title) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Descrição (opcional)',
    placeHolder: 'Descreve a tarefa...',
  });

  const priorityItem = await vscode.window.showQuickPick(
    [
      { label: '🔵 Baixa', value: 'low' as const },
      { label: '🟢 Normal', value: 'normal' as const },
      { label: '🟠 Alta', value: 'high' as const },
      { label: '🔴 Crítica', value: 'critical' as const },
    ],
    { placeHolder: 'Prioridade' },
  );
  if (!priorityItem) return;

  const payload: CreateCardPayload = {
    title,
    description: description || undefined,
    columnId: columnId,
    priority: priorityItem.value,
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Criando card...' },
    async () => {
      try {
        const card = await boardsClient.createCard(projectId, payload);
        vscode.window.showInformationMessage(`Card "${card.title}" criado`);
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Erro ao criar card: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

export async function createCardFromSelectionCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('Seleciona código no editor primeiro.');
    return;
  }

  if (!boardsClient.isConfigured()) {
    const action = await vscode.window.showErrorMessage(
      'Configura a API Key do Anturio primeiro.',
      'Abrir Definições',
    );
    if (action) vscode.commands.executeCommand('anturio.openSettings');
    return;
  }

  const sel = editor.selection;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const relativePath = workspaceFolder
    ? editor.document.uri.fsPath.replace(workspaceFolder.uri.fsPath, '').replace(/\\/g, '/').replace(/^\//, '')
    : editor.document.uri.fsPath;

  const snippet = editor.document.getText(sel).slice(0, 200);
  const defaultTitle = `${relativePath}:${sel.start.line + 1}`;

  const title = await vscode.window.showInputBox({
    prompt: 'Título do card',
    value: defaultTitle,
    placeHolder: 'Descreve o que precisa de ser feito neste código',
  });
  if (!title) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Descrição (opcional)',
    value: `\`\`\`\n${snippet}\n\`\`\``,
  });

  const picked = await pickProjectAndColumn();
  if (!picked) return;

  const payload: CreateCardPayload = {
    title,
    description: description || undefined,
    columnId: picked.column?.id,
    priority: 'normal',
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Criando card...' },
    async () => {
      try {
        const card = await boardsClient.createCard(picked.project.id, payload);
        vscode.window.showInformationMessage(`Card "${card.title}" criado em ${card.status_label}`);
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Erro ao criar card: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { boardsClient, CreateCardPayload } from '../api/boardsClient';

function getAnthropicClient(): Anthropic {
  const apiKey = vscode.workspace.getConfiguration('anturio').get<string>('apiKey', '');
  if (!apiKey) throw new Error('API Key não configurada.');
  return new Anthropic({ apiKey });
}

function getModel(): string {
  return vscode.workspace.getConfiguration('anturio').get<string>('ai.model', 'claude-sonnet-4-6');
}

function getSelectedCode(): { code: string; language: string; file: string } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return undefined;
  return {
    code: editor.document.getText(editor.selection),
    language: editor.document.languageId,
    file: editor.document.fileName.split(/[\\/]/).pop() ?? 'unknown',
  };
}

export async function aiSuggestCardCommand(): Promise<void> {
  const selected = getSelectedCode();
  if (!selected) {
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

  let suggestion: { title: string; description: string; priority: string } | undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'AI a analisar o código...' },
    async () => {
      try {
        const client = getAnthropicClient();
        const message = await client.messages.create({
          model: getModel(),
          max_tokens: 512,
          system: `És um assistente de gestão de projetos num editor de código.
Analisa o código e sugere uma tarefa clara e acionável.
Responde APENAS com JSON válido:
{"title": "...", "description": "...", "priority": "low|medium|high|urgent"}
- title: máx 80 chars, imperativo (ex: "Corrigir", "Adicionar", "Refatorar")
- description: 2-3 frases sobre o que fazer e porquê
- priority: escolhe o nível de urgência adequado ao problema`,
          messages: [
            {
              role: 'user',
              content: `Ficheiro: ${selected.file}\nLinguagem: ${selected.language}\n\n\`\`\`${selected.language}\n${selected.code.slice(0, 2000)}\n\`\`\``,
            },
          ],
        });

        const text = message.content[0].type === 'text' ? message.content[0].text : '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) suggestion = JSON.parse(match[0]);
      } catch (err) {
        vscode.window.showErrorMessage(`Erro na AI: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  if (!suggestion) return;

  const title = await vscode.window.showInputBox({
    prompt: 'Título sugerido pela AI (podes editar)',
    value: suggestion.title,
  });
  if (!title) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Descrição sugerida pela AI (podes editar)',
    value: suggestion.description,
  });

  let projects;
  try {
    projects = await boardsClient.getProjects();
  } catch (err) {
    vscode.window.showErrorMessage(`Erro ao carregar projetos: ${err instanceof Error ? err.message : err}`);
    return;
  }

  if (projects.length === 0) {
    vscode.window.showWarningMessage('Cria um projeto primeiro no painel do Anturio.');
    return;
  }

  const projectItem = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.title, description: p.workspace_name, project: p })),
    { placeHolder: 'Seleciona o projeto' },
  );
  if (!projectItem) return;

  const data = await boardsClient.getProjectCards(projectItem.project.id);

  let columnId: string | undefined;
  if (data.columns.length > 0) {
    const colItem = await vscode.window.showQuickPick(
      [
        { label: '$(arrow-right) Primeira coluna por defeito', column: undefined },
        ...data.columns.map((c) => ({ label: c.title, column: c })),
      ],
      { placeHolder: 'Seleciona a coluna (opcional)' },
    );
    if (!colItem) return;
    columnId = colItem.column?.id;
  }

  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  const priority = validPriorities.includes(suggestion.priority)
    ? (suggestion.priority as CreateCardPayload['priority'])
    : 'medium';

  const payload: CreateCardPayload = {
    title,
    descriptions: description ? [{ id: Date.now(), title: 'Descrição', content: description }] : undefined,
    columnId,
    priority,
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Criando card...' },
    async () => {
      try {
        const card = await boardsClient.createCard(projectItem.project.id, payload);
        vscode.window.showInformationMessage(
          `AI criou o card "${card.title}" em ${card.status_label}`,
        );
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Erro ao criar card: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

import * as vscode from 'vscode';
import { boardsClient, Card } from '../api/boardsClient';

export async function moveCardCommand(card: Card): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return;
  }

  try {
    const projects = await boardsClient.getProjects();
    const columnItems: { label: string; columnId: string; projectId: number }[] = [];

    for (const project of projects) {
      const projectData = await boardsClient.getProjectCards(project.id);
      for (const col of projectData.columns) {
        columnItems.push({
          label: `${col.title} (${project.title})`,
          columnId: col.id,
          projectId: project.id,
        });
      }
    }

    if (columnItems.length === 0) {
      vscode.window.showErrorMessage('Anturio: Não encontrei colunas.');
      return;
    }

    const otherColumns = columnItems.filter((c) => c.columnId !== card.status);

    if (otherColumns.length === 0) {
      vscode.window.showInformationMessage('Este card já está na única coluna disponível.');
      return;
    }

    const selected = await vscode.window.showQuickPick(otherColumns, {
      placeHolder: `Move "${card.title}" para:`,
      ignoreFocusOut: true,
    });

    if (!selected) return;

    await boardsClient.updateCard(card.id, { columnId: selected.columnId });
    vscode.window.showInformationMessage(`Card movido para "${selected.label.split(' (')[0]}"`);
    vscode.commands.executeCommand('anturio.refresh');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    vscode.window.showErrorMessage(`Anturio: ${msg}`);
  }
}
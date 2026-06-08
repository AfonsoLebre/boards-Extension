import * as vscode from 'vscode';
import { boardsClient, Card } from '../api/boardsClient';

export async function editCardCommand(card: Card): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return;
  }

  const choices = [
    { label: 'Título', type: 'title' },
    { label: 'Descrição', type: 'description' },
    { label: 'Prioridade', type: 'priority' },
    { label: 'Data limite', type: 'due_date' },
  ];

  const selected = await vscode.window.showQuickPick(choices, {
    placeHolder: `Editar "${card.title}" — escolhe o campo:`,
    ignoreFocusOut: true,
  });

  if (!selected) return;

  switch (selected.type) {
    case 'title': {
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
      break;
    }

    case 'description': {
      const newDesc = await vscode.window.showInputBox({
        prompt: 'Nova descrição do card',
        value: card.description ?? '',
        ignoreFocusOut: true,
      });
      if (newDesc === undefined || newDesc === card.description) return;
      try {
        await boardsClient.updateCard(card.id, { description: newDesc });
        vscode.window.showInformationMessage('Descrição alterada.');
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }

    case 'priority': {
      const priorityOptions: { label: string; value: Card['priority'] }[] = [
        { label: '🟢 Baixa', value: 'low' },
        { label: '🟡 Média', value: 'medium' },
        { label: '🟠 Alta', value: 'high' },
        { label: '🔴 Urgente', value: 'urgent' },
      ];
      const newPriority = await vscode.window.showQuickPick(priorityOptions, {
        placeHolder: 'Nova prioridade:',
        ignoreFocusOut: true,
      });
      if (!newPriority || newPriority.value === card.priority) return;
      try {
        await boardsClient.updateCard(card.id, { priority: newPriority.value });
        vscode.window.showInformationMessage(`Prioridade alterada para "${newPriority.label}"`);
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }

    case 'due_date': {
      const newDueDate = await vscode.window.showInputBox({
        prompt: 'Nova data limite (YYYY-MM-DD)',
        value: card.due_date ?? '',
        ignoreFocusOut: true,
      });
      if (newDueDate === undefined || newDueDate === card.due_date) return;
      try {
        await boardsClient.updateCard(card.id, { due_date: newDueDate });
        vscode.window.showInformationMessage(`Data limite alterada para "${newDueDate}"`);
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }
  }
}
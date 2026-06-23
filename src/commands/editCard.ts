import * as vscode from 'vscode';
import { boardsClient, Card, CardDescription } from '../api/boardsClient';

// Validate DD-MM-YYYY date format
function isValidDateFormat(dateStr: string): boolean {
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return false;
  const day = parseInt(match[1]);
  const month = parseInt(match[2]);
  const year = parseInt(match[3]);
  // Check valid date
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// Convert DD-MM-YYYY to YYYY-MM-DD for API
function convertToAPIDateFormat(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  if (!isValidDateFormat(dateStr)) return undefined;
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return dateStr;
  return `${match[3]}-${match[2]}-${match[1]}`; // YYYY-MM-DD
}

// Convert YYYY-MM-DD (API format) to DD-MM-YYYY for display
function convertFromAPIDateFormat(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  return `${match[3]}-${match[2]}-${match[1]}`; // DD-MM-YYYY
}

export async function editCardCommand(card: Card): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return;
  }

  const choices: { label: string; type: string; descIdx?: number }[] = [
    { label: 'Título', type: 'title' },
  ];

  // Add descriptions as separate options
  if (card.descriptions && card.descriptions.length > 0) {
    card.descriptions.forEach((d, idx) => {
      choices.push({ label: `Descrição: ${d.title}`, type: 'description', descIdx: idx });
    });
  } else if (card.description) {
    // Legacy singular description
    choices.push({ label: 'Descrição', type: 'description' });
  }
  choices.push({ label: 'Prioridade', type: 'priority' });
  choices.push({ label: 'Data de início', type: 'start_date' });
  choices.push({ label: 'Data limite', type: 'due_date' });

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
      // Check if this is a specific description from the array
      const descIdx = (selected as any).descIdx;
      if (descIdx !== undefined && card.descriptions && card.descriptions[descIdx]) {
        // Editing a specific description from the array
        const currentDesc = card.descriptions[descIdx];
        const newDesc = await vscode.window.showInputBox({
          prompt: `Nova descrição "${currentDesc.title}"`,
          value: currentDesc.content ?? '',
          ignoreFocusOut: true,
        });
        if (newDesc === undefined || newDesc === currentDesc.content) return;
        try {
          // Get full card to update descriptions array
          const fullCard = await boardsClient.getCardDetails(card.id);
          const descriptions = fullCard.descriptions || [];
          if (descriptions[descIdx]) {
            descriptions[descIdx].content = newDesc;
            await boardsClient.updateCardRaw(card.id, { descriptions });
            vscode.window.showInformationMessage(`Descrição "${currentDesc.title}" alterada.`);
            vscode.commands.executeCommand('anturio.refresh');
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        }
      } else {
        // Legacy singular description
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
      }
      break;
    }

    case 'priority': {
      const priorityOptions: { label: string; value: Card['priority'] }[] = [
        { label: '🔵 Baixa', value: 'low' },
        { label: '🟢 Normal', value: 'normal' },
        { label: '🟠 Alta', value: 'high' },
        { label: '🔴 Crítica', value: 'critical' },
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
        prompt: 'Nova data limite (DD-MM-YYYY). Deixe vazio para remover.',
        value: convertFromAPIDateFormat(card.due_date),
        ignoreFocusOut: true,
      });
      if (newDueDate === undefined) return;
      // Validate format if not empty
      if (newDueDate.trim() !== '' && !isValidDateFormat(newDueDate.trim())) {
        vscode.window.showErrorMessage('Formato inválido. Use DD-MM-YYYY (ex: 31-12-2025)');
        return;
      }
      // Empty string to remove the date (send null), otherwise convert to API format
      const dueDateValue = newDueDate.trim() === '' ? null : convertToAPIDateFormat(newDueDate.trim());
      // Compare input values (both in DD-MM-YYYY or empty)
      const inputChanged = newDueDate.trim() !== convertFromAPIDateFormat(card.due_date);
      if (!inputChanged) return;
      try {
        // Get user email for activity log, use PUT for logging
        const userEmail = await boardsClient.getCurrentUserEmail();
        await boardsClient.updateCardRaw(card.id, { dueDate: dueDateValue, user_email: userEmail ?? undefined });
        vscode.window.showInformationMessage(dueDateValue ? `Data limite alterada para "${newDueDate.trim()}"` : 'Data limite removida');
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }

    case 'start_date': {
      const newStartDate = await vscode.window.showInputBox({
        prompt: 'Nova data de início (DD-MM-YYYY). Deixe vazio para remover.',
        value: convertFromAPIDateFormat(card.start_date),
        ignoreFocusOut: true,
      });
      if (newStartDate === undefined) return;
      // Validate format if not empty
      if (newStartDate.trim() !== '' && !isValidDateFormat(newStartDate.trim())) {
        vscode.window.showErrorMessage('Formato inválido. Use DD-MM-YYYY (ex: 31-12-2025)');
        return;
      }
      // Empty string to remove the date (send null), otherwise convert to API format
      const startDateValue = newStartDate.trim() === '' ? null : convertToAPIDateFormat(newStartDate.trim());
      // Compare input values (both in DD-MM-YYYY or empty)
      const inputChanged = newStartDate.trim() !== convertFromAPIDateFormat(card.start_date);
      if (!inputChanged) return;
      try {
        // Get user email for activity log, use startDate (camelCase) as the API expects
        const userEmail = await boardsClient.getCurrentUserEmail();
        await boardsClient.updateCardRaw(card.id, { startDate: startDateValue, user_email: userEmail ?? undefined });
        vscode.window.showInformationMessage(startDateValue ? `Data de início alterada para "${newStartDate.trim()}"` : 'Data de início removida');
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }
  }
}
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

export async function editCardCommand(card: Card, projectId?: number): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return;
  }

  // Use projectId from parameter, fallback to card.project_id
  const effectiveProjectId = projectId ?? card.project_id;

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
  choices.push({ label: 'Labels', type: 'labels' });

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
        // Get user email and name for activity log
        const userEmail = await boardsClient.getCurrentUserEmail();
        const userName = await boardsClient.getCurrentUserName();
        await boardsClient.updateCardRaw(card.id, { dueDate: dueDateValue, user_email: userEmail ?? undefined, user_name: userName ?? undefined });
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
        // Get user email and name for activity log
        const userEmail = await boardsClient.getCurrentUserEmail();
        const userName = await boardsClient.getCurrentUserName();
        await boardsClient.updateCardRaw(card.id, { startDate: startDateValue, user_email: userEmail ?? undefined, user_name: userName ?? undefined });
        vscode.window.showInformationMessage(startDateValue ? `Data de início alterada para "${newStartDate.trim()}"` : 'Data de início removida');
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }

    case 'labels': {
      // Get current labels from the card
      const currentLabels = card.labels || [];

      // Get project labels dynamically
      let projectLabels: { text: string; color: string }[] = [];
      if (effectiveProjectId) {
        try {
          projectLabels = await boardsClient.getProjectLabels(effectiveProjectId);
        } catch {
          // Keep empty, will use fallback
        }
      }
      // If no project labels or error, use current card labels
      if (projectLabels.length === 0) {
        const labelMap = new Map<string, string>();
        currentLabels.forEach((l) => labelMap.set(l.text, l.color));
        projectLabels = Array.from(labelMap.entries()).map(([text, color]) => ({ text, color }));
      }
      // If still empty, provide default set
      if (projectLabels.length === 0) {
        projectLabels = [
          { text: 'Bug', color: '#e74c3c' },
          { text: 'Feature', color: '#f1c40f' },
          { text: 'Melhoria', color: '#3498db' },
          { text: 'Documentation', color: '#2ecc71' },
          { text: 'Urgente', color: '#9b59b6' },
          { text: 'Revisão', color: '#e67e22' },
          { text: 'blocked', color: '#34495e' },
          { text: 'Teste', color: '#95a5a6' },
        ];
      }

      // Create label options with emoji prefix based on color
      const getEmoji = (color: string): string => {
        const c = color.toLowerCase();
        if (c.includes('red') || c === '#e74c3c') return '🔴';
        if (c.includes('yellow') || c === '#f1c40f') return '🟡';
        if (c.includes('blue') || c === '#3498db') return '🔵';
        if (c.includes('green') || c === '#2ecc71') return '🟢';
        if (c.includes('purple') || c === '#9b59b6') return '🟣';
        if (c.includes('orange') || c === '#e67e22') return '🟠';
        if (c.includes('gray') || c.includes('grey') || c === '#34495e' || c === '#95a5a6') return '⚫';
        return '🏷️';
      };

      const labelOptions = projectLabels.map((l) => ({
        label: `${getEmoji(l.color)} ${l.text}`,
        picked: false,
        text: l.text,
        color: l.color,
      }));

      // Mark current labels as selected
      const currentLabelTexts = currentLabels.map((l) => l.text);
      labelOptions.forEach((opt) => {
        opt.picked = currentLabelTexts.includes(opt.text);
      });

      const selectedLabels = await vscode.window.showQuickPick(labelOptions, {
        placeHolder: 'Selecione as labels (selecione várias):',
        canPickMany: true,
        ignoreFocusOut: true,
      });

      if (!selectedLabels) return;
      // Get list of selected label texts
      const newLabelTexts = selectedLabels.map((s) => s.text);
      // Check if labels changed
      const labelsChanged = JSON.stringify(newLabelTexts.sort()) !== JSON.stringify(currentLabelTexts.sort());
      if (!labelsChanged) return;

      try {
        const userEmail = await boardsClient.getCurrentUserEmail();
        const userName = await boardsClient.getCurrentUserName();
        // Build label objects with text and color
        const newLabels = newLabelTexts.map((text) => {
          const opt = labelOptions.find((o) => o.text === text);
          return { text, color: opt?.color || '#999' };
        });
        await boardsClient.updateCardRaw(card.id, { labels: newLabels as any, user_email: userEmail ?? undefined, user_name: userName ?? undefined });
        const msg = newLabelTexts.length > 0
          ? `Labels alteradas: ${newLabelTexts.join(', ')}`
          : 'Labels removidas';
        vscode.window.showInformationMessage(msg);
        vscode.commands.executeCommand('anturio.refresh');
      } catch (err) {
        vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
      break;
    }
  }
}
import * as vscode from 'vscode';
import { boardsClient, Card } from '../api/boardsClient';

export async function archiveCardCommand(card: Card): Promise<void> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return;
  }

  const isArchived = card.archived === true;
  const buttonLabel = isArchived ? 'Desarquivar' : 'Arquivar';

  const confirmed = await vscode.window.showWarningMessage(
    `${isArchived ? 'Desarquivar' : 'Arquivar'} card "${card.title}"?`,
    { modal: true },
    buttonLabel,
  );

  if (confirmed !== buttonLabel) return;

  try {
    const userEmail = await boardsClient.getCurrentUserEmail();
    const userName = await boardsClient.getCurrentUserName();
    await boardsClient.updateCardRaw(card.id, {
      archived: !isArchived,
      user_email: userEmail ?? undefined,
      user_name: userName ?? undefined,
    });
    const message = isArchived ? `Card "${card.title}" desarquivado.` : `Card "${card.title}" arquivado.`;
    vscode.window.showInformationMessage(message);
    vscode.commands.executeCommand('anturio.refresh');
  } catch (err) {
    vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
  }
}
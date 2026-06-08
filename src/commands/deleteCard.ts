import * as vscode from 'vscode';
import { boardsClient, Card } from '../api/boardsClient';

export async function deleteCardCommand(card: Card): Promise<boolean> {
  if (!boardsClient.isConfigured()) {
    vscode.window.showErrorMessage('Anturio: API Key não configurada.');
    return false;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Apagar card "${card.title}"?`,
    { modal: true },
    'Apagar',
    'Cancelar',
  );

  if (confirmed !== 'Apagar') return false;

  try {
    await boardsClient.deleteCard(card.id);
    vscode.window.showInformationMessage(`Card "${card.title}" apagado.`);
    vscode.commands.executeCommand('anturio.refresh');
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Anturio: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    return false;
  }
}
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import localtunnel from 'localtunnel';
import { boardsClient } from '../api/boardsClient';

interface Tunnel {
  url: string;
  on(event: 'close', cb: () => void): void;
  close(): void;
}

let mcpHttpProcess: ChildProcess | null = null;
let tunnel: Tunnel | null = null;
const MCP_HTTP_PORT = 3100;

interface TunnelConnection {
  url: string | null;
  port: number;
}

async function startMcpServerHttp(): Promise<TunnelConnection> {
  const config = vscode.workspace.getConfiguration('anturio');
  const apiKey = config.get<string>('apiKey', '');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3001');

  // Find the mcp-server dist/index.js
  const ext = vscode.extensions.getExtension('anturio.boards');
  const extPath = ext?.extensionPath ?? '';
  const mcpServerPath = path.join(extPath, 'mcp-server', 'dist', 'index.js');

  if (!fs.existsSync(mcpServerPath)) {
    throw new Error(`MCP server not found at: ${mcpServerPath}`);
  }

  // Kill existing process
  if (mcpHttpProcess) {
    mcpHttpProcess.kill();
    mcpHttpProcess = null;
  }

  return new Promise((resolve, reject) => {
    mcpHttpProcess = spawn('node', [mcpServerPath], {
      env: {
        ...process.env,
        TRANSPORT: 'http',
        MCP_PORT: MCP_HTTP_PORT.toString(),
        ANTURIO_API_KEY: apiKey,
        ANTURIO_SERVER_URL: serverUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let isResolved = false;

    mcpHttpProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      console.log(`[MCP HTTP] ${msg}`);
      if (msg.includes('running on http://localhost')) {
        if (!isResolved) {
          isResolved = true;
          resolve({ url: null, port: MCP_HTTP_PORT });
        }
      }
    });

    mcpHttpProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP HTTP Error] ${data.toString().trim()}`);
    });

    mcpHttpProcess.on('error', (err: Error) => {
      if (!isResolved) {
        isResolved = true;
        reject(err);
      }
    });

    mcpHttpProcess.on('exit', (code: number | null) => {
      if (code !== 0) {
        console.error(`[MCP HTTP] Process exited with code ${code}`);
      }
    });

    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({ url: null, port: MCP_HTTP_PORT });
      }
    }, 10000);
  });
}

async function createTunnel(port: number): Promise<string> {
  const t: Tunnel = await localtunnel({ port });
  tunnel = t;
  console.log(`[Tunnel] Public URL: ${tunnel.url}`);
  return tunnel.url;
}

export async function startMcpHttpCommand(): Promise<void> {
  if (!boardsClient.isConfigured()) {
    const action = await vscode.window.showErrorMessage(
      'Configura a API Key do Anturio primeiro.',
      'Abrir Definições',
    );
    if (action) vscode.commands.executeCommand('anturio.openSettings');
    return;
  }

  const existingTunnel = tunnel;
  if (existingTunnel) {
    const action = await vscode.window.showWarningMessage(
      'O túnel MCP já está ativo. Queres reiniciar?',
      'Sim',
      'Não',
    );
    if (action !== 'Sim') return;

    existingTunnel.close();
    tunnel = null;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'A iniciar servidor MCP...' },
    async () => {
      try {
        const { port } = await startMcpServerHttp();
        console.log(`[Anturio] MCP HTTP server started on port ${port}`);

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'A criar túnel público...' },
          async () => {
            try {
              const tunnelUrl = await createTunnel(port);
              console.log(`[Anturio] Tunnel ready: ${tunnelUrl}`);

              await vscode.env.clipboard.writeText(tunnelUrl);
              vscode.window.showInformationMessage(
                `Túnel criado: ${tunnelUrl}\n\nURL copiada para a área de transferência. Usa este URL no Blackbox para configurar o MCP server.`,
              );
            } catch (err) {
              vscode.window.showErrorMessage(
                `Erro ao criar túnel: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Erro ao iniciar MCP: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

export async function stopMcpHttpCommand(): Promise<void> {
  if (tunnel) {
    tunnel.close();
    tunnel = null;
    console.log('[Anturio] Tunnel closed');
  }

  if (mcpHttpProcess) {
    mcpHttpProcess.kill();
    mcpHttpProcess = null;
    console.log('[Anturio] MCP HTTP server stopped');
  }

  vscode.window.showInformationMessage('Servidor MCP HTTP parado.');
}

export function getTunnelUrl(): string | null {
  return tunnel?.url ?? null;
}
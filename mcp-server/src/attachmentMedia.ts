import fs from 'fs';
import path from 'path';
import {
  ATTACHMENT_CACHE_DIR,
  ensureDir,
  mimeToExt,
  sanitizeFilename,
  toMarkdownFilePath,
  toMarkdownImagePath,
} from './mediaCache.js';
import { fetchAttachmentBinary } from './api.js';
import type { ToolContent } from './descriptionMedia.js';

export interface AttachmentInput {
  name: string;
  url: string;
  type?: string;
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.xml', '.csv', '.log', '.yml', '.yaml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx',
]);

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript'];

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p));
}

function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function getAttachmentBuffer(att: AttachmentInput): Promise<{ buffer: Buffer; mimeType: string }> {
  if (att.url.startsWith('data:')) {
    const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error(`Formato data URL inválido no anexo "${att.name}"`);
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
  }
  return fetchAttachmentBinary(att.url);
}

function saveAttachmentFile(cardId: number, index: number, name: string, buffer: Buffer, mimeType: string): string {
  ensureDir(ATTACHMENT_CACHE_DIR);
  const safeName = sanitizeFilename(name);
  const ext = path.extname(safeName) || mimeToExt(mimeType, safeName);
  const filename = `card-${cardId}-att-${index + 1}-${path.basename(safeName, path.extname(safeName))}${ext}`;
  const filepath = path.join(ATTACHMENT_CACHE_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

/** Materializa um anexo em disco e devolve blocos para a IA (preview + caminho local). */
export async function materializeAttachment(
  cardId: number,
  index: number,
  att: AttachmentInput,
): Promise<ToolContent[]> {
  const { buffer, mimeType } = await getAttachmentBuffer(att);
  const savedPath = saveAttachmentFile(cardId, index, att.name, buffer, mimeType);
  const openLink = toMarkdownFilePath(savedPath, att.name);
  const contents: ToolContent[] = [
    { type: 'text', text: `ANEXO ${index + 1}: ${att.name} | tipo: ${mimeType}` },
  ];

  if (mimeType.startsWith('image/')) {
    contents.push({ type: 'text', text: toMarkdownImagePath(savedPath, att.name) });
    contents.push({ type: 'image', data: buffer.toString('base64'), mimeType });
  } else if (isTextMime(mimeType) || isTextFile(att.name)) {
    const text = buffer.toString('utf-8');
    const max = 80_000;
    const preview = text.length > max ? `${text.slice(0, max)}\n...(conteúdo truncado — abre o ficheiro completo)` : text;
    contents.push({ type: 'text', text: `CONTEUDO:\n${preview}` });
    contents.push({ type: 'text', text: `ABRIR: ${openLink}` });
  } else {
    contents.push({ type: 'text', text: `ABRIR: ${openLink}` });
  }

  return contents;
}

export async function materializeAllAttachments(cardId: number, attachments: AttachmentInput[]): Promise<ToolContent[]> {
  const content: ToolContent[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (!att?.name || !att?.url) continue;
    try {
      content.push(...(await materializeAttachment(cardId, i, att)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      content.push({ type: 'text', text: `ANEXO ${i + 1}: ${att.name} | ERRO: ${msg}` });
    }
  }
  return content;
}

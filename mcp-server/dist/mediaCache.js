import fs from 'fs';
import path from 'path';
import os from 'os';
export const IMAGE_CACHE_DIR = process.env.ANTURIO_IMAGE_CACHE_DIR ??
    path.join(os.homedir(), '.cursor', 'anturio-boards-images');
export const ATTACHMENT_CACHE_DIR = process.env.ANTURIO_ATTACHMENT_CACHE_DIR ??
    path.join(path.dirname(IMAGE_CACHE_DIR), 'card-attachments');
const WORKSPACE_ROOT = process.env.ANTURIO_WORKSPACE_ROOT;
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
export function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'ficheiro';
}
export function mimeToExt(mimeType, fallbackName) {
    const fromName = fallbackName ? path.extname(fallbackName) : '';
    if (fromName)
        return fromName;
    const subtype = mimeType.split('/')[1] ?? 'bin';
    const map = {
        jpeg: '.jpg',
        png: '.png',
        gif: '.gif',
        webp: '.webp',
        'svg+xml': '.svg',
        plain: '.txt',
        pdf: '.pdf',
        json: '.json',
        markdown: '.md',
    };
    return map[subtype] ?? `.${subtype.replace('+xml', '')}`;
}
export function toMarkdownFilePath(filepath, label) {
    const normalized = path.resolve(filepath).replace(/\\/g, '/');
    const workspaceRoot = WORKSPACE_ROOT ? path.resolve(WORKSPACE_ROOT).replace(/\\/g, '/') : undefined;
    if (workspaceRoot && normalized.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}/`)) {
        const relative = normalized.slice(workspaceRoot.length).replace(/^\//, '');
        return `[${label}](${relative})`;
    }
    if (normalized.match(/^[A-Za-z]:\//)) {
        return `[${label}](file:///${normalized})`;
    }
    return `[${label}](file://${normalized})`;
}
export function toMarkdownImagePath(filepath, alt) {
    const link = toMarkdownFilePath(filepath, alt);
    return `!${link}`;
}

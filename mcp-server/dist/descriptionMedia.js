import fs from 'fs';
import path from 'path';
import os from 'os';
const IMAGE_CACHE_DIR = process.env.ANTURIO_IMAGE_CACHE_DIR ??
    path.join(os.homedir(), '.cursor', 'anturio-boards-images');
const WORKSPACE_ROOT = process.env.ANTURIO_WORKSPACE_ROOT?.replace(/\\/g, '/');
function ensureImageCacheDir() {
    fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}
function mimeToExt(mimeType) {
    const subtype = mimeType.split('/')[1] ?? 'png';
    return subtype.replace('jpeg', 'jpg');
}
function saveDescriptionImage(cardId, imageIndex, mimeType, base64) {
    ensureImageCacheDir();
    const filename = `card-${cardId}-${imageIndex}.${mimeToExt(mimeType)}`;
    const filepath = path.join(IMAGE_CACHE_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
    return filepath;
}
function toMarkdownImagePath(filepath, alt) {
    const normalized = path.resolve(filepath).replace(/\\/g, '/');
    const workspaceRoot = WORKSPACE_ROOT ? path.resolve(WORKSPACE_ROOT).replace(/\\/g, '/') : undefined;
    if (workspaceRoot && normalized.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}/`)) {
        const relative = normalized.slice(workspaceRoot.length).replace(/^\//, '');
        return `![${alt}](${relative})`;
    }
    if (normalized.match(/^[A-Za-z]:\//)) {
        return `![${alt}](file:///${normalized})`;
    }
    return `![${alt}](file://${normalized})`;
}
function getImgAlt(tag, fallback) {
    return tag.match(/\balt=["']([^"']*)["']/i)?.[1]?.trim() || fallback;
}
function cleanHtmlDescription(html) {
    if (!html)
        return '';
    return html
        .replace(/<\/?(p|div|br)\s*\/?>/gi, '\n')
        .replace(/<\/?h[1-6][^>]*>/gi, '\n')
        .replace(/<\/?(ul|li)\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/**
 * Converte HTML da descrição em blocos de texto e imagens intercalados.
 * Imagens base64 são guardadas em disco; o markdown usa caminhos curtos (não base64).
 */
export function parseDescriptionContent(html, cardId) {
    const content = [];
    let imageIndex = 0;
    let cursor = 0;
    const imgTagRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let match;
    const pushText = (chunk) => {
        const text = cleanHtmlDescription(chunk);
        if (text)
            content.push({ type: 'text', text });
    };
    const pushImage = (parsed) => {
        content.push({ type: 'text', text: `\n${parsed.markdown}\n` });
        content.push({ type: 'image', data: parsed.data, mimeType: parsed.mimeType });
    };
    const parseBase64Image = (src, alt) => {
        const m = src.match(/^data:image\/([^;]+);base64,(.+)$/i);
        if (!m)
            return null;
        imageIndex++;
        const mimeType = `image/${m[1]}`;
        const data = m[2].replace(/\s/g, '');
        const savedPath = saveDescriptionImage(cardId, imageIndex, mimeType, data);
        return { mimeType, data, alt, markdown: toMarkdownImagePath(savedPath, alt) };
    };
    while ((match = imgTagRegex.exec(html)) !== null) {
        if (match.index > cursor) {
            pushText(html.slice(cursor, match.index));
        }
        const src = match[1];
        const alt = getImgAlt(match[0], 'Imagem');
        const base64Image = parseBase64Image(src, alt);
        if (base64Image) {
            pushImage(base64Image);
        }
        else {
            const url = src.startsWith('/') ? resolveServerUrl(src) : src;
            content.push({ type: 'text', text: `\n![${alt}](${url})\n` });
        }
        cursor = match.index + match[0].length;
    }
    if (cursor < html.length) {
        const remaining = html.slice(cursor);
        const bareRegex = /data:image\/([^;]+);base64,([A-Za-z0-9+/=\s]+)/gi;
        let last = 0;
        let bareMatch;
        while ((bareMatch = bareRegex.exec(remaining)) !== null) {
            if (bareMatch.index > last) {
                pushText(remaining.slice(last, bareMatch.index));
            }
            const parsed = parseBase64Image(`data:image/${bareMatch[1]};base64,${bareMatch[2].replace(/\s/g, '')}`, 'Imagem');
            if (parsed)
                pushImage(parsed);
            last = bareMatch.index + bareMatch[0].length;
        }
        if (last < remaining.length) {
            pushText(remaining.slice(last));
        }
    }
    return content;
}
function resolveServerUrl(src) {
    const serverUrl = (process.env.ANTURIO_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${serverUrl}${src}`;
}

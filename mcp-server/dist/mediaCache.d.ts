export declare const IMAGE_CACHE_DIR: string;
export declare const ATTACHMENT_CACHE_DIR: string;
export declare function ensureDir(dir: string): void;
export declare function sanitizeFilename(name: string): string;
export declare function mimeToExt(mimeType: string, fallbackName?: string): string;
export declare function toMarkdownFilePath(filepath: string, label: string): string;
export declare function toMarkdownImagePath(filepath: string, alt: string): string;

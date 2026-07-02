import type { ToolContent } from './descriptionMedia.js';
export interface AttachmentInput {
    name: string;
    url: string;
    type?: string;
}
/** Materializa um anexo em disco e devolve blocos para a IA (preview + caminho local). */
export declare function materializeAttachment(cardId: number, index: number, att: AttachmentInput): Promise<ToolContent[]>;
export declare function materializeAllAttachments(cardId: number, attachments: AttachmentInput[]): Promise<ToolContent[]>;

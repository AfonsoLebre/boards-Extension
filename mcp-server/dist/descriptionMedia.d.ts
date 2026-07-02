export type ToolContent = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    data: string;
    mimeType: string;
};
/**
 * Converte HTML da descrição em blocos de texto e imagens intercalados.
 * Imagens base64 são guardadas em disco; o markdown usa caminhos curtos (não base64).
 */
export declare function parseDescriptionContent(html: string, cardId: number): ToolContent[];

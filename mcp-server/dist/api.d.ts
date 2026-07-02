export interface Project {
    id: number;
    title: string;
    manager: string;
    workspace_id: number;
    workspace_name: string;
    created_at: string;
}
export interface Column {
    id: string;
    title: string;
}
export interface CardDescription {
    id: number;
    title: string;
    content: string;
}
export interface CardChecklistItemMember {
    email?: string;
    name?: string;
    icon_url?: string;
}
export interface CardChecklistItem {
    id: string;
    title?: string;
    text?: string;
    completed?: boolean;
    checked?: boolean;
    assignedMembers?: CardChecklistItemMember[];
    assigned_members?: CardChecklistItemMember[];
    members?: CardChecklistItemMember[];
}
export interface CardChecklist {
    id: string;
    title: string;
    items: CardChecklistItem[];
}
export interface CardAttachment {
    id?: string;
    name: string;
    url: string;
    type?: string;
}
export interface Card {
    id: number;
    title: string;
    description?: string;
    descriptions?: CardDescription[];
    status: string;
    status_label: string;
    priority: string;
    start_date?: string;
    due_date?: string;
    members: Array<{
        email: string;
        name: string;
        icon_url?: string;
    }>;
    labels: Array<{
        text: string;
        color: string;
    }>;
    checklists?: CardChecklist[];
    attachments?: CardAttachment[];
    cover?: string;
    project_id?: number;
}
export type DescriptionInput = {
    id?: number;
    title: string;
    content: string;
};
export declare function getDescriptionsList(card: Card): DescriptionInput[];
export declare function updateCardRaw(cardId: number, payload: Record<string, unknown>): Promise<Card>;
export declare function addCardDescription(cardId: number, title: string, content?: string): Promise<Card>;
export declare function updateCardDescription(cardId: number, descriptionIndex: number, updates: {
    title?: string;
    content?: string;
}): Promise<Card>;
export declare function deleteCardDescription(cardId: number, descriptionIndex: number): Promise<Card>;
export declare function fetchAttachmentBinary(url: string): Promise<{
    buffer: Buffer;
    mimeType: string;
}>;
export declare function listProjects(): Promise<Project[]>;
export declare function getProjectCards(projectId: number): Promise<{
    columns: Column[];
    cards: Card[];
}>;
export declare function createCard(projectId: number, payload: {
    title: string;
    description?: string;
    columnId?: string;
    priority?: string;
    due_date?: string;
}): Promise<Card>;
export declare function moveCard(cardId: number, columnId: string): Promise<Card>;
export declare function deleteCard(cardId: number): Promise<void>;
export interface CardComment {
    id: number;
    user_email: string;
    user_name: string;
    type: string;
    content: string;
    created_at: string;
}
export declare function getCardComments(cardId: number): Promise<CardComment[]>;
export declare function getCardDetails(cardId: number): Promise<Card>;

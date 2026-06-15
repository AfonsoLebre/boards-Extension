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
    }>;
    labels: Array<{
        text: string;
        color: string;
    }>;
}
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

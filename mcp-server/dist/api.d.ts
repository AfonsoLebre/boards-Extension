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
export interface Card {
    id: number;
    title: string;
    description?: string;
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

import type { Card } from './api.js';
export type ChecklistMember = {
    email: string;
    name?: string;
    icon_url?: string;
};
export type ChecklistItemInput = {
    id?: string;
    text: string;
    completed: boolean;
    checked: boolean;
    assignedMembers?: ChecklistMember[];
};
export type ChecklistInput = {
    id?: string;
    title: string;
    items: ChecklistItemInput[];
};
export declare function getChecklistsList(card: Card): ChecklistInput[];
export declare function addCardChecklist(cardId: number, title: string): Promise<Card>;
export declare function updateCardChecklist(cardId: number, checklistIndex: number, title: string): Promise<Card>;
export declare function deleteCardChecklist(cardId: number, checklistIndex: number): Promise<Card>;
export declare function addChecklistItem(cardId: number, checklistIndex: number, text: string): Promise<Card>;
export declare function updateChecklistItem(cardId: number, checklistIndex: number, itemIndex: number, updates: {
    text?: string;
    completed?: boolean;
    member_emails?: string[] | null;
    add_member_emails?: string[];
    remove_member_emails?: string[];
}): Promise<Card>;
export declare function deleteChecklistItem(cardId: number, checklistIndex: number, itemIndex: number): Promise<Card>;
export declare function memberHasIcon(member?: ChecklistMember): boolean;

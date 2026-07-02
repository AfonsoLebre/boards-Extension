import { ensureCardProjectId, getCardDetails, getProjectParticipantsEnriched, updateCardRaw, } from './api.js';
function cloneRawChecklists(card) {
    return JSON.parse(JSON.stringify(card.checklists ?? []));
}
async function saveRawChecklists(cardId, checklists) {
    return updateCardRaw(cardId, { checklists });
}
function getItemMembers(item) {
    return item.assignedMembers ?? item.assigned_members ?? [];
}
function setItemMembers(item, members) {
    item.assignedMembers = members;
}
function normalizeMember(m) {
    return {
        email: m.email ?? '',
        name: m.name,
        icon_url: m.icon_url,
    };
}
function normalizeItem(item) {
    const text = item.text || item.title || '';
    const completed = Boolean(item.completed || item.checked);
    const members = getItemMembers(item);
    return {
        id: item.id,
        text,
        completed,
        checked: completed,
        assignedMembers: members.map(normalizeMember).filter((m) => m.email),
    };
}
export function getChecklistsList(card) {
    return (card.checklists ?? []).map((cl) => ({
        id: cl.id,
        title: cl.title || 'Sem titulo',
        items: (cl.items ?? []).map(normalizeItem),
    }));
}
function resolveChecklist(checklists, checklistIndex) {
    const idx = checklistIndex - 1;
    if (idx < 0 || idx >= checklists.length) {
        throw new Error(`Checklist ${checklistIndex} não encontrada (total: ${checklists.length})`);
    }
    return idx;
}
function resolveItem(checklist, itemIndex) {
    const idx = itemIndex - 1;
    if (idx < 0 || idx >= (checklist.items?.length ?? 0)) {
        throw new Error(`Item ${itemIndex} não encontrado (total: ${checklist.items?.length ?? 0})`);
    }
    return idx;
}
/** Igual ao DetalhesTrabDev.jsx: { name, email, icon_url: p.icon_url } */
function participantToAssignedMember(participant, email) {
    return {
        email,
        name: participant?.name || email,
        ...(participant?.icon_url ? { icon_url: participant.icon_url } : {}),
    };
}
async function resolveAssignedMembers(emails, card) {
    const cardWithProject = await ensureCardProjectId(card);
    if (!cardWithProject.project_id) {
        throw new Error('Não foi possível determinar o projeto do cartão para resolver avatares dos membros');
    }
    const participants = await getProjectParticipantsEnriched(cardWithProject.project_id);
    return emails.map((email) => {
        const participant = participants.find((p) => p.email?.toLowerCase() === email.toLowerCase());
        return participantToAssignedMember(participant, email);
    });
}
export async function addCardChecklist(cardId, title) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    checklists.push({ title, items: [] });
    return saveRawChecklists(cardId, checklists);
}
export async function updateCardChecklist(cardId, checklistIndex, title) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    const idx = resolveChecklist(checklists, checklistIndex);
    checklists[idx].title = title;
    return saveRawChecklists(cardId, checklists);
}
export async function deleteCardChecklist(cardId, checklistIndex) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    const idx = resolveChecklist(checklists, checklistIndex);
    checklists.splice(idx, 1);
    return saveRawChecklists(cardId, checklists);
}
export async function addChecklistItem(cardId, checklistIndex, text) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    const idx = resolveChecklist(checklists, checklistIndex);
    checklists[idx].items = checklists[idx].items ?? [];
    checklists[idx].items.push({ text, checked: false, completed: false });
    return saveRawChecklists(cardId, checklists);
}
export async function updateChecklistItem(cardId, checklistIndex, itemIndex, updates) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    const clIdx = resolveChecklist(checklists, checklistIndex);
    const itemIdx = resolveItem(checklists[clIdx], itemIndex);
    const item = checklists[clIdx].items[itemIdx];
    if (updates.text !== undefined) {
        item.text = updates.text;
        item.title = updates.text;
    }
    if (updates.completed !== undefined) {
        item.completed = updates.completed;
        item.checked = updates.completed;
    }
    if (updates.member_emails !== undefined) {
        setItemMembers(item, updates.member_emails === null || updates.member_emails.length === 0
            ? []
            : await resolveAssignedMembers(updates.member_emails, card));
    }
    else if (updates.add_member_emails?.length || updates.remove_member_emails?.length) {
        const current = [...getItemMembers(item)];
        const removeSet = new Set((updates.remove_member_emails ?? []).map((e) => e.toLowerCase()));
        let next = current.filter((m) => !m.email || !removeSet.has(m.email.toLowerCase()));
        const existingEmails = new Set(next.map((m) => m.email?.toLowerCase()).filter(Boolean));
        const toAdd = (updates.add_member_emails ?? []).filter((e) => !existingEmails.has(e.toLowerCase()));
        if (toAdd.length > 0) {
            const resolved = await resolveAssignedMembers(toAdd, card);
            next = [...next, ...resolved];
        }
        setItemMembers(item, next);
    }
    return saveRawChecklists(cardId, checklists);
}
export async function deleteChecklistItem(cardId, checklistIndex, itemIndex) {
    const card = await getCardDetails(cardId);
    const checklists = cloneRawChecklists(card);
    const clIdx = resolveChecklist(checklists, checklistIndex);
    const itemIdx = resolveItem(checklists[clIdx], itemIndex);
    checklists[clIdx].items.splice(itemIdx, 1);
    return saveRawChecklists(cardId, checklists);
}
export function memberHasIcon(member) {
    return Boolean(member?.icon_url);
}

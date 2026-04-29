import type { Note } from './state';

const LOCK_API = import.meta.env.VITE_LOCK_API_URL as string;

export async function fetchNotes(): Promise<Note[]> {
    const res = await fetch(`${LOCK_API}/api/notes`);
    if (!res.ok) return [];
    return res.json();
}

export async function addNote(
    token: string,
    roomId: number,
    text: string,
    commandsJson?: string,
): Promise<{ message: string; result: boolean }> {
    const res = await fetch(`${LOCK_API}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId, text, ...(commandsJson ? { commandsJson } : {}) }),
    });
    return res.json();
}

export async function markNoteApplied(token: string, noteId: string): Promise<{ message: string }> {
    const res = await fetch(`${LOCK_API}/api/notes/${noteId}/applied`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
    });
    try { return await res.json(); } catch { return { message: '' }; }
}

export async function deleteNote(token: string, noteId: string): Promise<{ message: string }> {
    const res = await fetch(`${LOCK_API}/api/notes/${noteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
}

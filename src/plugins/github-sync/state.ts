export interface Note {
    id: string;
    roomId: number;
    text?: string;
    user: string;
    createdAt: number;
    /** JSON-serialized Command[] from the editor undo stack. */
    commandsJson?: string;
}

const TOKEN_KEY = 'github_sync_token';

type Listener = () => void;
const listeners = new Set<Listener>();

let _token: string | null = localStorage.getItem(TOKEN_KEY);
let _savedBytes: Uint8Array | null = null;
let _hasLock = false;

function notify() { listeners.forEach((l) => l()); }

export function subscribe(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
}

export function getToken() { return _token; }
export function setToken(token: string) { _token = token; localStorage.setItem(TOKEN_KEY, token); notify(); }
export function clearToken() { _token = null; localStorage.removeItem(TOKEN_KEY); notify(); }

export function getSavedBytes() { return _savedBytes; }
export function setSavedBytes(b: Uint8Array) { _savedBytes = b; notify(); }

export function getHasLock() { return _hasLock; }
export function setHasLock(v: boolean) { _hasLock = v; notify(); }

let _mapVersion: string | null = null;
export function getMapVersion() { return _mapVersion; }
export function setMapVersion(v: string | null) { _mapVersion = v; notify(); }

export interface LockOwner { user: string; expiresAt: number; }
let _lockOwner: LockOwner | null = null;
export function getLockOwner() { return _lockOwner; }
export function setLockOwner(v: LockOwner | null) { _lockOwner = v; notify(); }

let _notes: Note[] = [];
export function getNotes() { return _notes; }
export function setNotes(v: Note[]) { _notes = v; notify(); }

const _appliedNoteIds = new Set<string>();
export function markNoteAppliedLocally(id: string) { _appliedNoteIds.add(id); notify(); }
export function isNoteAppliedLocally(id: string) { return _appliedNoteIds.has(id); }

// Recording state — lives at module level so it survives sidebar tab switches.
let _recording = false;
let _recordStartIdx = 0;
let _recordedCmds: unknown[] = [];

export function isRecording() { return _recording; }
export function getRecordStartIdx() { return _recordStartIdx; }
export function getRecordedCmds() { return _recordedCmds; }
export function setRecordedCmds(cmds: unknown[]) { _recordedCmds = cmds; }

export function startRecording(undoIdx: number) {
    _recording = true;
    _recordStartIdx = undoIdx;
    _recordedCmds = [];
    notify();
}
export function stopRecording() { _recording = false; notify(); }

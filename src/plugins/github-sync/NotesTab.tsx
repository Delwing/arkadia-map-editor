import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState, pushCommand } from 'mudlet-map-editor';
import {
    subscribe, getToken, getNotes, setNotes,
    isRecording, getRecordStartIdx, startRecording, stopRecording,
    getRecordedCmds, setRecordedCmds,
    markNoteAppliedLocally, isNoteAppliedLocally,
} from './state';
import { fetchNotes, addNote, deleteNote } from './notesApi';
import type { Note } from './state';

// Derive the Command type from the public pushCommand signature.
type AnyCommand = Parameters<typeof pushCommand>[0];

function flattenCmds(cmds: AnyCommand[]): AnyCommand[] {
    return cmds.flatMap((cmd) =>
        cmd.kind === 'batch' ? flattenCmds(cmd.cmds as AnyCommand[]) : [cmd],
    );
}

function summarizeCmd(cmd: AnyCommand): string {
    switch (cmd.kind) {
        case 'addRoom':       return `add room #${cmd.id}`;
        case 'deleteRoom':    return `delete room #${cmd.id}`;
        case 'moveRoom':      return `move room #${cmd.id} → (${cmd.to.x}, ${cmd.to.y}, ${cmd.to.z})`;
        case 'setRoomField':  return `set ${cmd.field} #${cmd.id}: ${cmd.to}`;
        case 'setRoomHash':   return `set hash #${cmd.id}: ${cmd.to ?? '—'}`;
        case 'setRoomLock':   return `${cmd.lock ? 'lock' : 'unlock'} room #${cmd.id}`;
        case 'addExit':       return `add exit #${cmd.fromId} ${cmd.dir} → #${cmd.toId}`;
        case 'removeExit':    return `remove exit #${cmd.fromId} ${cmd.dir}`;
        case 'addSpecialExit':    return `add special exit "${cmd.name}" #${cmd.roomId} → #${cmd.toId}`;
        case 'removeSpecialExit': return `remove special exit "${cmd.name}" #${cmd.roomId}`;
        case 'setUserDataEntry':  return `userData[${cmd.key}] #${cmd.roomId}: ${cmd.to ?? '—'}`;
        case 'setCustomLine': return `set custom line "${cmd.exitName}" #${cmd.roomId}`;
        case 'removeCustomLine':  return `remove custom line "${cmd.exitName}" #${cmd.roomId}`;
        case 'setDoor':       return `set door ${cmd.dir} #${cmd.roomId}: ${cmd.to}`;
        case 'setExitWeight': return `set exit weight ${cmd.dir} #${cmd.roomId}: ${cmd.to}`;
        case 'renameArea':    return `rename area #${cmd.id}: ${cmd.to}`;
        case 'moveRoomsToArea': return `move ${cmd.roomIds.length} room(s) to area #${cmd.toAreaId}`;
        case 'batch':         return `batch (${cmd.cmds.length})`;
        default:              return (cmd as any).kind;
    }
}

function navigateToRoom(roomId: number) {
    const s = store.getState();
    const room = s.map?.rooms[roomId];
    if (!room) return;
    const areaChanged = room.area !== s.currentAreaId;
    const zChanged = room.z !== s.currentZ;
    if (areaChanged || zChanged) {
        store.setState({
            selection: { kind: 'room', ids: [roomId] },
            sidebarTab: 'notes',
            currentAreaId: room.area,
            currentZ: room.z,
            navigateTo: { mapX: room.x, mapY: -room.y },
        });
        store.bumpStructure();
    } else {
        store.setState({
            selection: { kind: 'room', ids: [roomId] },
            sidebarTab: 'notes',
            panRequest: { mapX: room.x, mapY: -room.y },
        });
    }
}

function applyNoteCommands(note: Note, sceneRef: { current: any }) {
    if (!note.commandsJson) return;
    let cmds: AnyCommand[];
    try { cmds = JSON.parse(note.commandsJson); } catch { return; }
    if (!cmds.length) return;
    navigateToRoom(note.roomId);
    const batchCmd: AnyCommand = cmds.length === 1 ? cmds[0] : ({ kind: 'batch', cmds } as any);
    const structural = pushCommand(batchCmd, sceneRef.current);
    sceneRef.current?.refresh?.();
    if (structural) store.bumpStructure();
    else store.bumpData();
    markNoteAppliedLocally(note.id);
}

interface NotesTabProps {
    sceneRef: { current: any };
}

export function NotesTab({ sceneRef }: NotesTabProps) {
    const { t } = useTranslation('arkadia');
    const [, rerender] = useState(0);
    const [newText, setNewText] = useState('');
    const [newRoomId, setNewRoomId] = useState('');
    const [pendingCmds, setPendingCmds] = useState<AnyCommand[]>(() => {
        // Restore commands that survived a tab switch.
        if (isRecording()) return [...store.getState().undo.slice(getRecordStartIdx())] as AnyCommand[];
        return [...getRecordedCmds()] as AnyCommand[];
    });
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    const selection = useEditorState((s) => s.selection);
    const undoLength = useEditorState((s) => s.undo.length);
    const selectedRoomId = selection?.kind === 'room' && selection.ids.length === 1 ? selection.ids[0] : null;

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    useEffect(() => {
        fetchNotes().then(setNotes);
    }, []);

    // While recording, keep pendingCmds in sync with the undo stack live.
    const recording = isRecording();
    useEffect(() => {
        if (!recording) return;
        const captured = store.getState().undo.slice(getRecordStartIdx());
        setPendingCmds([...captured]);
    }, [recording, undoLength]);

    const token = getToken();
    const notes = getNotes();
    const map = store.getState().map;

    const handleStartRecording = () => {
        setPendingCmds([]);
        startRecording(store.getState().undo.length);
    };

    const handleStopRecording = () => {
        const captured = [...store.getState().undo.slice(getRecordStartIdx())] as AnyCommand[];
        setRecordedCmds(captured);
        setPendingCmds(captured);
        stopRecording();
    };

    const handleClearCommands = () => {
        stopRecording();
        setRecordedCmds([]);
        setPendingCmds([]);
    };

    const handleAdd = async () => {
        if (!token || !newRoomId.trim() || (!newText.trim() && pendingCmds.length === 0)) return;
        const roomId = Number(newRoomId);
        if (!Number.isInteger(roomId) || roomId <= 0) { setStatus(t('notes.invalidRoomId')); return; }
        setBusy(true);
        try {
            const commandsJson = pendingCmds.length > 0 ? JSON.stringify(pendingCmds) : undefined;
            const res = await addNote(token, roomId, newText.trim(), commandsJson);
            setStatus(res.message);
            if (res.result) {
                setNewText('');
                setPendingCmds([]);
                setRecordedCmds([]);
                stopRecording();
                setNotes(await fetchNotes());
            }
        } catch (e) {
            setStatus(String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (noteId: string) => {
        if (!token) return;
        setBusy(true);
        try {
            const res = await deleteNote(token, noteId);
            setStatus(res.message);
            setNotes(await fetchNotes());
        } catch (e) {
            setStatus(String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleRefresh = () => {
        fetchNotes().then((n) => { setNotes(n); setStatus(''); });
    };

    const sorted = [...notes].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{t('notes.title')}</h3>
                <button type="button" onClick={handleRefresh}>{t('notes.refresh')}</button>
            </div>

            {token && (
                <div style={{ marginBottom: 16, borderBottom: '1px solid #313244', paddingBottom: 14 }}>
                    <div className="field" style={{ marginBottom: 6 }}>
                        <label style={{ fontSize: '0.85em', color: '#a6adc8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            {t('notes.roomIdLabel')}
                            {selectedRoomId != null && (
                                <button
                                    type="button"
                                    style={{ fontSize: '0.85em', padding: '1px 6px' }}
                                    onClick={() => setNewRoomId(String(selectedRoomId))}
                                >
                                    {t('notes.useSelected', { id: selectedRoomId })}
                                </button>
                            )}
                        </label>
                        <input
                            type="number"
                            value={newRoomId}
                            onChange={(e) => setNewRoomId(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                    <div className="field" style={{ marginBottom: 8 }}>
                        <textarea
                            placeholder={t('notes.textPlaceholder')}
                            value={newText}
                            onChange={(e) => setNewText(e.target.value)}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                        />
                    </div>

                    {/* Recording section */}
                    <div style={{ marginBottom: 16 }}>
                        {recording ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.85em', lineHeight: 1 }}>
                                <span style={{ color: '#f38ba8', fontWeight: 'bold', lineHeight: 1 }}>
                                    ● {t('notes.recording')}
                                </span>
                                <span style={{ color: '#a6adc8', lineHeight: 1 }}>
                                    {t('notes.recordedCount', { count: pendingCmds.length })}
                                </span>
                                <button type="button" style={{ marginLeft: 'auto', lineHeight: 1 }} onClick={handleStopRecording}>
                                    {t('notes.recordStop')}
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: pendingCmds.length > 0 ? 6 : 0, fontSize: '0.85em', lineHeight: 1 }}>
                                <button type="button" style={{ lineHeight: 1 }} onClick={handleStartRecording}>
                                    {t('notes.record')}
                                </button>
                                {pendingCmds.length > 0 && (
                                    <>
                                        <span style={{ color: '#a6adc8', lineHeight: 1 }}>
                                            {t('notes.recordedCount', { count: pendingCmds.length })}
                                        </span>
                                        <button
                                            type="button"
                                            style={{ marginLeft: 'auto', color: '#f38ba8', lineHeight: 1 }}
                                            onClick={handleClearCommands}
                                        >
                                            {t('notes.clearCommands')}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                        {recording && pendingCmds.length === 0 && (
                            <p className="hint" style={{ margin: '4px 0 0', fontSize: '0.8em' }}>
                                {t('notes.recordHint')}
                            </p>
                        )}
                        {pendingCmds.length > 0 && (
                            <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
                                {flattenCmds(pendingCmds).map((cmd, i) => (
                                    <span key={i} style={{ fontSize: '0.78em', color: '#89b4fa', fontFamily: 'monospace', paddingLeft: 10 }}>
                                        {summarizeCmd(cmd)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        disabled={busy || !newRoomId.trim() || (!newText.trim() && pendingCmds.length === 0) || recording}
                        onClick={handleAdd}
                    >
                        {t('notes.addButton')}
                    </button>
                </div>
            )}

            {sorted.length === 0 ? (
                <p className="hint">{t('notes.empty')}</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sorted.map((note) => {
                        const room = map?.rooms[note.roomId];
                        const roomName = room?.name ?? null;
                        let cmds: AnyCommand[] | null = null;
                        if (note.commandsJson) {
                            try { cmds = JSON.parse(note.commandsJson); } catch { /* ignore */ }
                        }
                        return (
                            <div key={note.id} style={{ padding: '8px 10px', background: '#1e1e2e', borderRadius: 6, border: '1px solid #313244' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <button
                                        type="button"
                                        className="exit-target"
                                        onClick={() => navigateToRoom(note.roomId)}
                                        title={t('notes.goToRoom')}
                                    >
                                        #{note.roomId}{roomName && String(note.roomId) !== roomName ? ` · ${roomName}` : ''}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => handleDelete(note.id)}
                                        style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '0.8em', color: '#f38ba8' }}
                                    >
                                        {t('notes.delete')}
                                    </button>
                                </div>
                                {note.text && (
                                    <p style={{ margin: '0 0 4px', fontSize: '0.9em', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{note.text}</p>
                                )}
                                {cmds && cmds.length > 0 && (
                                    <div style={{ marginBottom: 4, maxHeight: 80, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        {flattenCmds(cmds).map((cmd, i) => (
                                            <span key={i} style={{ fontSize: '0.78em', color: '#89b4fa', fontFamily: 'monospace', paddingLeft: 10 }}>
                                                {summarizeCmd(cmd)}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {isNoteAppliedLocally(note.id) && (
                                    <div style={{ marginBottom: 4, fontSize: '0.75em', color: '#a6e3a1', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span>✓</span>
                                        <span>{t('notes.applied')}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ fontSize: '0.75em', color: '#6c7086' }}>
                                        {note.user}{note.createdAt ? ` · ${new Date(note.createdAt).toLocaleDateString('pl-PL')}` : ''}
                                    </div>
                                    {cmds && cmds.length > 0 && map && (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => applyNoteCommands(note, sceneRef)}
                                            style={{ fontSize: '0.8em', padding: '2px 8px', color: isNoteAppliedLocally(note.id) ? '#6c7086' : '#a6e3a1' }}
                                            title={t('notes.applyTitle')}
                                        >
                                            {t(isNoteAppliedLocally(note.id) ? 'notes.reapply' : 'notes.apply')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {status && <p className="hint" style={{ marginTop: 12, wordBreak: 'break-word' }}>{status}</p>}
        </>
    );
}

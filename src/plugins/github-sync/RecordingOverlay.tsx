import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from 'mudlet-map-editor';
import { subscribe, isRecording, getRecordStartIdx, stopRecording, setRecordedCmds } from './state';

export function RecordingOverlay() {
    const { t } = useTranslation('arkadia');
    const [, rerender] = useState(0);
    const undoLength = useEditorState((s) => s.undo.length);

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    if (!isRecording()) return null;

    const count = Math.max(0, undoLength - getRecordStartIdx());

    return (
        <div style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 500,
            background: '#1e1e2e',
            border: '2px solid #f38ba8',
            borderRadius: 8,
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            pointerEvents: 'all',
            fontSize: '0.9em',
            lineHeight: 1,
        }}>
            <span style={{ color: '#f38ba8', fontWeight: 'bold', lineHeight: 1 }}>
                ● {t('notes.recording')}
            </span>
            <span style={{ color: '#cdd6f4', lineHeight: 1 }}>
                {t('notes.recordedCount', { count })}
            </span>
            <button type="button" onClick={() => {
                setRecordedCmds([...store.getState().undo.slice(getRecordStartIdx())]);
                stopRecording();
                store.setState({ sidebarTab: 'notes' });
            }} style={{ flexShrink: 0, lineHeight: 1 }}>
                {t('notes.recordStop')}
            </button>
        </div>
    );
}

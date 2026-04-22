import { useEffect, useRef, useState } from 'react';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { pushCommand, store, useEditorState } from 'mudlet-map-editor';
import arkadiaLogo from './arkadia-logo.svg';
import './arkadia.css';

const DIR_BIND_KEY = 'dir_bind';

const ALL_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'] as const;

function parseDirBind(raw: string | undefined): [string, string][] {
  if (!raw) return [];
  return raw
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      return idx === -1
        ? [pair, ''] as [string, string]
        : [pair.slice(0, idx), pair.slice(idx + 1)] as [string, string];
    });
}

function serializeDirBind(entries: [string, string][]): string {
  return entries.map(([dir, cmd]) => `${dir}=${cmd}`).join('&');
}

function DirEntryCard({ dir, cmd, onUpdate, onRemove }: {
  dir: string;
  cmd: string;
  onUpdate: (v: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(cmd);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(cmd);
  }, [cmd]);

  return (
    <div className="gps-entry">
      <div className="gps-entry-header">
        <span className="gps-entry-index">{dir}</span>
        <button type="button" className="ud-delete" title="Remove" onClick={onRemove}>×</button>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Commands</label>
        <input
          ref={inputRef}
          className="ark-input"
          value={draft}
          placeholder="cmd1#cmd2"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== cmd) onUpdate(draft); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
    </div>
  );
}

function DirAddForm({ availableDirs, onConfirm, onCancel }: {
  availableDirs: readonly string[];
  onConfirm: (dir: string, cmd: string) => void;
  onCancel: () => void;
}) {
  const [dir, setDir] = useState(availableDirs[0] ?? '');
  const [cmd, setCmd] = useState('');

  return (
    <div className="gps-entry gps-entry--add">
      <div className="gps-entry-header">
        <span className="gps-entry-index">new</span>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Direction</label>
        <select
          className="gps-area-select"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
        >
          {availableDirs.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Commands</label>
        <input
          className="ark-input"
          placeholder="cmd1#cmd2"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && cmd.trim() && onConfirm(dir, cmd)}
          autoFocus
        />
      </div>
      <div className="gps-add-actions">
        <button type="button" onClick={() => onConfirm(dir, cmd)} disabled={!cmd.trim()}>Add</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function DirBindSection({ roomId, room, sceneRef }: RoomSectionProps) {
  useEditorState((s) => s.dataVersion);
  const raw = room.userData?.[DIR_BIND_KEY];
  const entries = parseDirBind(raw);
  const usedDirs = new Set(entries.map(([d]) => d));
  const availableDirs = ALL_DIRS.filter((d) => !usedDirs.has(d));

  const [addOpen, setAddOpen] = useState(false);

  function commit(nextEntries: [string, string][]) {
    const currentRaw = room.userData?.[DIR_BIND_KEY] ?? null;
    const to = nextEntries.length > 0 ? serializeDirBind(nextEntries) : null;
    if (currentRaw === to) return;
    pushCommand({ kind: 'setUserDataEntry', roomId, key: DIR_BIND_KEY, from: currentRaw, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  }

  function removeEntry(dir: string) {
    commit(parseDirBind(room.userData?.[DIR_BIND_KEY]).filter(([d]) => d !== dir));
  }

  function updateCmd(dir: string, newValue: string) {
    commit(parseDirBind(room.userData?.[DIR_BIND_KEY]).map(([d, c]) => (d === dir ? [d, newValue] : [d, c])));
  }

  function addEntry(dir: string, cmd: string) {
    const current = parseDirBind(room.userData?.[DIR_BIND_KEY]);
    commit([...current, [dir, cmd]]);
    setAddOpen(false);
  }

  return (
    <>
      <h4>
        Direction Binds
        <img src={arkadiaLogo} alt="Arkadia" style={{ height: '2.5em', verticalAlign: 'middle', marginLeft: 6, marginTop: '-0.75em', marginBottom: '-0.75em' }} />
      </h4>
      <div className="gps-list">
        {entries.map(([dir, cmd]) => (
          <DirEntryCard
            key={dir}
            dir={dir}
            cmd={cmd}
            onUpdate={(v) => updateCmd(dir, v)}
            onRemove={() => removeEntry(dir)}
          />
        ))}
        {entries.length === 0 && !addOpen && (
          <div className="gps-empty">— no direction binds —</div>
        )}
        {addOpen && availableDirs.length > 0 && (
          <DirAddForm
            availableDirs={availableDirs}
            onConfirm={addEntry}
            onCancel={() => setAddOpen(false)}
          />
        )}
        {!addOpen && availableDirs.length > 0 && (
          <button type="button" className="gps-add-btn" onClick={() => setAddOpen(true)}>+ Add direction bind</button>
        )}
      </div>
    </>
  );
}

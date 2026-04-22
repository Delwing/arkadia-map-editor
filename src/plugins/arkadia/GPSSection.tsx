import { useEffect, useState } from 'react';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { pushCommand, store } from 'mudlet-map-editor';
import arkadiaLogo from './arkadia-logo.svg';
import './arkadia.css';

const GPS_KEY = 'gps';

interface GpsEntry {
  room_id: number;
  gps_string_lines: string[];
  line_delta: number;
  area_name?: string;
  within_room_ids?: number[];
}

function parseGps(data: Record<string, string> | undefined): GpsEntry[] {
  const raw = data?.[GPS_KEY];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function blankEntry(roomId: number): GpsEntry {
  return { room_id: roomId, gps_string_lines: [], line_delta: 0 };
}

function GpsEntryRow({ entry, idx, areaNames, onUpdate, onRemove }: {
  entry: GpsEntry;
  idx: number;
  areaNames: string[];
  onUpdate: (patch: Partial<GpsEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="gps-entry">
      <div className="gps-entry-header">
        <span className="gps-entry-index">#{idx + 1}</span>
        <button type="button" className="ud-delete" onClick={onRemove} title="Remove GPS entry">×</button>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Area</label>
        <select
          className="gps-area-select"
          value={entry.area_name ?? ''}
          onChange={(e) => onUpdate({ area_name: e.target.value || undefined })}
        >
          <option value="">— any area —</option>
          {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Trigger lines</label>
        <textarea
          key={`gps-lines-${idx}-${entry.gps_string_lines.join('\n')}`}
          className="gps-textarea"
          defaultValue={entry.gps_string_lines.join('\n')}
          rows={Math.max(2, entry.gps_string_lines.length)}
          placeholder="one trigger line per line"
          onBlur={(e) => {
            const lines = e.target.value.split('\n').filter((l) => l.length > 0);
            onUpdate({ gps_string_lines: lines });
          }}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label" title="Line offset for multi-line trigger matching">Line delta</label>
        <input
          type="number"
          className="gps-small-input"
          key={`gps-ld-${idx}-${entry.line_delta}`}
          defaultValue={entry.line_delta}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v !== entry.line_delta) onUpdate({ line_delta: v });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label" title="Only apply when currently in these rooms (comma-separated IDs)">Within rooms</label>
        <input
          type="text"
          className="gps-within-input"
          placeholder="IDs, comma-separated"
          key={`gps-wr-${idx}-${(entry.within_room_ids ?? []).join(',')}`}
          defaultValue={(entry.within_room_ids ?? []).join(', ')}
          onBlur={(e) => {
            const ids = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
            onUpdate({ within_room_ids: ids.length ? ids : undefined });
          }}
        />
      </div>
    </div>
  );
}

function GpsAddForm({ draft, areaNames, onChange, onConfirm, onCancel }: {
  draft: GpsEntry;
  areaNames: string[];
  onChange: (patch: Partial<GpsEntry>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState(draft.gps_string_lines.join('\n'));

  return (
    <div className="gps-entry gps-entry--add">
      <div className="gps-entry-header">
        <span className="gps-entry-index">new</span>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Area</label>
        <select
          className="gps-area-select"
          value={draft.area_name ?? ''}
          onChange={(e) => onChange({ area_name: e.target.value || undefined })}
        >
          <option value="">— any area —</option>
          {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Trigger lines</label>
        <textarea
          className="gps-textarea"
          value={lines}
          rows={3}
          placeholder="one trigger line per line"
          onChange={(e) => setLines(e.target.value)}
          onBlur={() => onChange({ gps_string_lines: lines.split('\n').filter((l) => l.length > 0) })}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Line delta</label>
        <input
          type="number"
          className="gps-small-input"
          value={draft.line_delta}
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange({ line_delta: v }); }}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label">Within rooms</label>
        <input
          type="text"
          className="gps-within-input"
          placeholder="IDs, comma-separated"
          defaultValue={(draft.within_room_ids ?? []).join(', ')}
          onBlur={(e) => {
            const ids = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
            onChange({ within_room_ids: ids.length ? ids : undefined });
          }}
        />
      </div>
      <div className="gps-add-actions">
        <button
          type="button"
          onClick={() => { onChange({ gps_string_lines: lines.split('\n').filter((l) => l.length > 0) }); onConfirm(); }}
          disabled={lines.trim().length === 0}
        >
          Add
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function GPSSection({ roomId, room, map, sceneRef }: RoomSectionProps) {
  const [entries, setEntries] = useState(() => parseGps(room.userData));
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(() => blankEntry(roomId));

  useEffect(() => {
    setEntries(parseGps(room.userData));
    setAddOpen(false);
    setDraft(blankEntry(roomId));
  }, [room, roomId]);

  const areaNames = Object.values(map.areaNames).sort();

  function applyUpdate(next: GpsEntry[]) {
    const from = room.userData?.[GPS_KEY] ?? null;
    const to = next.length ? JSON.stringify(next) : null;
    if (from === to) return;
    pushCommand({ kind: 'setUserDataEntry', roomId, key: GPS_KEY, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    setEntries(next);
  }

  function updateEntry(idx: number, patch: Partial<GpsEntry>) {
    applyUpdate(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  function removeEntry(idx: number) {
    applyUpdate(entries.filter((_, i) => i !== idx));
  }

  function addEntry() {
    const lines = draft.gps_string_lines.filter((l) => l.length > 0);
    if (lines.length === 0) return;
    applyUpdate([...entries, { ...draft, gps_string_lines: lines }]);
    setDraft(blankEntry(roomId));
    setAddOpen(false);
  }

  return (
    <>
      <h4>
        GPS Triggers
        <img src={arkadiaLogo} alt="Arkadia" style={{ height: '2.5em', verticalAlign: 'middle', marginLeft: 6, marginTop: '-0.75em', marginBottom: '-0.75em' }} />
      </h4>
      <div className="gps-list">
        {entries.map((entry, idx) => (
          <GpsEntryRow
            key={idx}
            entry={entry}
            idx={idx}
            areaNames={areaNames}
            onUpdate={(patch) => updateEntry(idx, patch)}
            onRemove={() => removeEntry(idx)}
          />
        ))}
        {entries.length === 0 && !addOpen && (
          <div className="gps-empty">— no GPS entries —</div>
        )}
        {addOpen && (
          <GpsAddForm
            draft={draft}
            areaNames={areaNames}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onConfirm={addEntry}
            onCancel={() => { setAddOpen(false); setDraft(blankEntry(roomId)); }}
          />
        )}
        {!addOpen && (
          <button type="button" className="gps-add-btn" onClick={() => setAddOpen(true)}>+ Add GPS entry</button>
        )}
      </div>
    </>
  );
}

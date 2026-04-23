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

function resizeTriggerTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function TriggerLinesList({
  lines,
  onChange,
  onCommit,
}: {
  lines: string[];
  onChange: (lines: string[]) => void;
  onCommit?: (lines: string[]) => void;
}) {
  const update = (i: number, val: string) => {
    const next = [...lines];
    next[i] = val;
    onChange(next);
  };

  const commit = () => onCommit?.(lines.filter((l) => l.length > 0));

  const remove = (i: number) => {
    const next = lines.filter((_, j) => j !== i);
    onChange(next);
    onCommit?.(next.filter((l) => l.length > 0));
  };

  const add = () => onChange([...lines, '']);

  return (
    <div className="gps-trigger-lines">
      {lines.map((line, i) => (
        <div key={i} className="gps-trigger-line-row">
          <span className="gps-trigger-line-num">{i + 1}</span>
          <textarea
            className="gps-trigger-line-input"
            value={line}
            placeholder="trigger pattern"
            rows={1}
            ref={(el) => { if (el) resizeTriggerTextarea(el); }}
            onChange={(e) => { update(i, e.target.value); resizeTriggerTextarea(e.currentTarget); }}
            onBlur={commit}
          />
          <button
            type="button"
            className="gps-trigger-line-remove"
            onClick={() => remove(i)}
            title="Remove line"
          >×</button>
        </div>
      ))}
      <button type="button" className="gps-trigger-line-add" onClick={add}>+ add line</button>
    </div>
  );
}

function GpsEntryRow({ entry, idx, areaNames, onUpdate, onRemove }: {
  entry: GpsEntry;
  idx: number;
  areaNames: string[];
  onUpdate: (patch: Partial<GpsEntry>) => void;
  onRemove: () => void;
}) {
  const [localLines, setLocalLines] = useState(entry.gps_string_lines);
  const cleanCount = localLines.filter((l) => l.length > 0).length;

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
        <label className="gps-field-label">
          Trigger lines
          {cleanCount > 0 && <span className="gps-line-count">{cleanCount}</span>}
        </label>
        <TriggerLinesList
          lines={localLines}
          onChange={setLocalLines}
          onCommit={(lines) => onUpdate({ gps_string_lines: lines })}
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
  onConfirm: (lines: string[]) => void;
  onCancel: () => void;
}) {
  const [localLines, setLocalLines] = useState<string[]>(draft.gps_string_lines);
  const cleanCount = localLines.filter((l) => l.length > 0).length;

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
        <label className="gps-field-label">
          Trigger lines
          {cleanCount > 0 && <span className="gps-line-count">{cleanCount}</span>}
        </label>
        <TriggerLinesList
          lines={localLines}
          onChange={setLocalLines}
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
          onClick={() => { const clean = localLines.filter((l) => l.length > 0); if (clean.length > 0) onConfirm(clean); }}
          disabled={cleanCount === 0}
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

  function addEntry(lines: string[]) {
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
            key={`${roomId}-${idx}`}
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

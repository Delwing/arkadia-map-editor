import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { pushCommand, store } from 'mudlet-map-editor';
import arkadiaLogo from './arkadia-logo.svg';
import './arkadia.css';

const GPS_KEY = 'gps';

interface GpsEntry {
  gps_string_lines: string[];
  // Parallel to gps_string_lines: the slot holding 'regex' makes that line a pattern,
  // anything else leaves it a literal matched as a substring of the game line.
  gps_line_modes?: (string | null)[];
  area_name?: string;
  within_room_ids?: number[];
  _uid?: string; // UI-only stable key, stripped before saving
}

let _uidSeq = 0;
function nextUid() { return `gps-${++_uidSeq}`; }

function parseGps(data: Record<string, string> | undefined): GpsEntry[] {
  const raw = data?.[GPS_KEY];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((
      { room_id: _room, line_delta: _delta, ...e }: GpsEntry & { room_id?: number; line_delta?: number },
    ) => ({ ...e, _uid: nextUid() }));
  } catch {
    return [];
  }
}

// Two keys older entries carry are dropped rather than round-tripped, because nothing
// reads them back: room_id (an entry belongs to the room it is saved in, and both
// clients sync to that room) and line_delta (the lines of a sequence have to be
// consecutive in both clients, whatever it says). They go the next time a room is saved.
function blankEntry(): GpsEntry {
  return { gps_string_lines: [], _uid: nextUid() };
}

function resizeTriggerTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function TriggerLinesList({
  lines,
  modes,
  onChange,
  onCommit,
}: {
  lines: string[];
  modes: (string | null)[];
  onChange: (lines: string[], modes: (string | null)[]) => void;
  onCommit?: (lines: string[], modes: (string | null)[]) => void;
}) {
  const { t } = useTranslation('arkadia');

  const modeOf = (i: number) => modes[i] ?? null;

  // A line and its mode travel together — dropping the blank lines on commit has to
  // drop their modes too, or every later line would take the wrong one.
  const clean = (nextLines: string[], nextModes: (string | null)[]) => {
    const keptLines: string[] = [];
    const keptModes: (string | null)[] = [];
    nextLines.forEach((line, i) => {
      if (line.length === 0) return;
      keptLines.push(line);
      keptModes.push(nextModes[i] ?? null);
    });
    return [keptLines, keptModes] as const;
  };

  const update = (i: number, val: string) => {
    const next = [...lines];
    next[i] = val;
    onChange(next, modes);
  };

  const toggleMode = (i: number) => {
    const next = [...modes];
    while (next.length < lines.length) next.push(null);
    next[i] = modeOf(i) === 'regex' ? null : 'regex';
    onChange(lines, next);
    onCommit?.(...clean(lines, next));
  };

  const commit = () => onCommit?.(...clean(lines, modes));

  const remove = (i: number) => {
    const nextLines = lines.filter((_, j) => j !== i);
    const nextModes = modes.filter((_, j) => j !== i);
    onChange(nextLines, nextModes);
    onCommit?.(...clean(nextLines, nextModes));
  };

  const add = () => onChange([...lines, ''], [...modes, null]);

  return (
    <div className="gps-trigger-lines">
      {lines.map((line, i) => (
        <div key={i} className="gps-trigger-line-row">
          <span className="gps-trigger-line-num">{i + 1}</span>
          <textarea
            className={modeOf(i) === 'regex' ? 'gps-trigger-line-input is-regex' : 'gps-trigger-line-input'}
            value={line}
            placeholder={modeOf(i) === 'regex' ? t('gps.regexPattern') : t('gps.triggerPattern')}
            rows={1}
            ref={(el) => { if (el) resizeTriggerTextarea(el); }}
            onChange={(e) => { update(i, e.target.value); resizeTriggerTextarea(e.currentTarget); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData('text').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
              const el = e.currentTarget;
              const start = el.selectionStart ?? 0;
              const end = el.selectionEnd ?? 0;
              const next = line.slice(0, start) + text + line.slice(end);
              update(i, next);
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + text.length; });
            }}
          />
          <button
            type="button"
            className={modeOf(i) === 'regex' ? 'gps-trigger-line-mode is-on' : 'gps-trigger-line-mode'}
            onClick={() => toggleMode(i)}
            title={modeOf(i) === 'regex' ? t('gps.regexOnTitle') : t('gps.regexOffTitle')}
          >.*</button>
          <button
            type="button"
            className="gps-trigger-line-remove"
            onClick={() => remove(i)}
            title={t('gps.removeLine')}
          >×</button>
        </div>
      ))}
      <button type="button" className="gps-trigger-line-add" onClick={add}>{t('gps.addLine')}</button>
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
  const { t } = useTranslation('arkadia');
  const [localLines, setLocalLines] = useState(entry.gps_string_lines);
  const [localModes, setLocalModes] = useState<(string | null)[]>(entry.gps_line_modes ?? []);
  const cleanCount = localLines.filter((l) => l.length > 0).length;

  return (
    <div className="gps-entry">
      <div className="gps-entry-header">
        <span className="gps-entry-index">#{idx + 1}</span>
        <button type="button" className="ud-delete" onClick={onRemove} title={t('gps.removeEntry')}>×</button>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('gps.area')}</label>
        <select
          className="gps-area-select"
          value={entry.area_name ?? ''}
          onChange={(e) => onUpdate({ area_name: e.target.value || undefined })}
        >
          <option value="">{t('gps.anyArea')}</option>
          {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">
          {t('gps.triggerLines')}
          {cleanCount > 0 && <span className="gps-line-count">{cleanCount}</span>}
        </label>
        <TriggerLinesList
          lines={localLines}
          modes={localModes}
          onChange={(lines, modes) => { setLocalLines(lines); setLocalModes(modes); }}
          onCommit={(lines, modes) => onUpdate({
            gps_string_lines: lines,
            gps_line_modes: modes.some((m) => m === 'regex') ? modes : undefined,
          })}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label" title={t('gps.withinRoomsTitle')}>{t('gps.withinRooms')}</label>
        <input
          type="text"
          className="gps-within-input"
          placeholder={t('gps.withinRoomsPlaceholder')}
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
  onConfirm: (lines: string[], modes: (string | null)[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('arkadia');
  const [localLines, setLocalLines] = useState<string[]>(draft.gps_string_lines);
  const [localModes, setLocalModes] = useState<(string | null)[]>(draft.gps_line_modes ?? []);
  const cleanCount = localLines.filter((l) => l.length > 0).length;

  return (
    <div className="gps-entry gps-entry--add">
      <div className="gps-entry-header">
        <span className="gps-entry-index">{t('common.new')}</span>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('gps.area')}</label>
        <select
          className="gps-area-select"
          value={draft.area_name ?? ''}
          onChange={(e) => onChange({ area_name: e.target.value || undefined })}
        >
          <option value="">{t('gps.anyArea')}</option>
          {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">
          {t('gps.triggerLines')}
          {cleanCount > 0 && <span className="gps-line-count">{cleanCount}</span>}
        </label>
        <TriggerLinesList
          lines={localLines}
          modes={localModes}
          onChange={(lines, modes) => { setLocalLines(lines); setLocalModes(modes); }}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('gps.withinRooms')}</label>
        <input
          type="text"
          className="gps-within-input"
          placeholder={t('gps.withinRoomsPlaceholder')}
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
          onClick={() => {
            const keptLines: string[] = [];
            const keptModes: (string | null)[] = [];
            localLines.forEach((line, i) => {
              if (line.length === 0) return;
              keptLines.push(line);
              keptModes.push(localModes[i] ?? null);
            });
            if (keptLines.length > 0) onConfirm(keptLines, keptModes);
          }}
          disabled={cleanCount === 0}
        >
          {t('common.add')}
        </button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

export function GPSSection({ roomId, room, map, sceneRef }: RoomSectionProps) {
  const { t } = useTranslation('arkadia');
  const [entries, setEntries] = useState(() => parseGps(room.userData));
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(() => blankEntry());

  useEffect(() => {
    setEntries(parseGps(room.userData));
    setAddOpen(false);
    setDraft(blankEntry());
  }, [room, roomId]);

  const areaNames = Object.values(map.areaNames).sort();

  function applyUpdate(next: GpsEntry[]) {
    const toSave = next.map(({ _uid: _, ...e }) => e);
    const from = room.userData?.[GPS_KEY] ?? null;
    const to = toSave.length ? JSON.stringify(toSave) : null;
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

  function addEntry(lines: string[], modes: (string | null)[]) {
    if (lines.length === 0) return;
    applyUpdate([...entries, {
      ...draft,
      gps_string_lines: lines,
      gps_line_modes: modes.some((m) => m === 'regex') ? modes : undefined,
    }]);
    setDraft(blankEntry());
    setAddOpen(false);
  }

  return (
    <>
      <h4>
        {t('gps.title')}
        <img src={arkadiaLogo} alt="Arkadia" style={{ height: '2.5em', verticalAlign: 'middle', marginLeft: 6, marginTop: '-0.75em', marginBottom: '-0.75em' }} />
      </h4>
      <div className="gps-list">
        {entries.map((entry, idx) => (
          <GpsEntryRow
            key={entry._uid}
            entry={entry}
            idx={idx}
            areaNames={areaNames}
            onUpdate={(patch) => updateEntry(idx, patch)}
            onRemove={() => removeEntry(idx)}
          />
        ))}
        {entries.length === 0 && !addOpen && (
          <div className="gps-empty">{t('gps.empty')}</div>
        )}
        {addOpen && (
          <GpsAddForm
            draft={draft}
            areaNames={areaNames}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onConfirm={addEntry}
            onCancel={() => { setAddOpen(false); setDraft(blankEntry()); }}
          />
        )}
        {!addOpen && (
          <button type="button" className="gps-add-btn" onClick={() => setAddOpen(true)}>{t('gps.addButton')}</button>
        )}
      </div>
    </>
  );
}

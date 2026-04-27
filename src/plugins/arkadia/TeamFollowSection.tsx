import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { pushCommand, store, useEditorState } from 'mudlet-map-editor';
import arkadiaLogo from './arkadia-logo.svg';
import './arkadia.css';

const TEAM_FOLLOW_KEY = 'team_follow_link';

type Room = RoomSectionProps['room'];

const DIR_FIELDS: [keyof Room, string][] = [
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
  ['northeast', 'ne'], ['northwest', 'nw'], ['southeast', 'se'], ['southwest', 'sw'],
  ['up', 'u'], ['down', 'd'], ['in', 'in'], ['out', 'out'],
];

function getExits(room: Room): string[] {
  const exits: string[] = [];
  for (const [field, abbr] of DIR_FIELDS) {
    if ((room[field] as number) > 0) exits.push(abbr);
  }
  exits.push(...Object.keys(room.mSpecialExits));
  return exits;
}

function parseLinks(raw: string | undefined): [string, string][] {
  if (!raw) return [];
  return raw
    .split('#')
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('*');
      return idx === -1
        ? [pair, ''] as [string, string]
        : [pair.slice(0, idx), pair.slice(idx + 1)] as [string, string];
    });
}

function serializeLinks(entries: [string, string][]): string {
  return entries.map(([from, to]) => `${from}*${to}`).join('#');
}

function ExitSelect({ value, exits, onChange }: {
  value: string;
  exits: string[];
  onChange: (v: string) => void;
}) {
  const options = exits.includes(value) ? exits : [value, ...exits];
  return (
    <select className="gps-area-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((e) => <option key={e} value={e}>{e}</option>)}
    </select>
  );
}

function LinkEntryCard({ idx, from, to, exits, onUpdate, onRemove }: {
  idx: number;
  from: string;
  to: string;
  exits: string[];
  onUpdate: (from: string, to: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('arkadia');
  const [draftFrom, setDraftFrom] = useState(from);

  useEffect(() => { setDraftFrom(from); }, [from]);

  return (
    <div className="gps-entry">
      <div className="gps-entry-header">
        <span className="gps-entry-index">#{idx + 1}</span>
        <button type="button" className="ud-delete" title={t('common.remove')} onClick={onRemove}>×</button>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('teamFollow.from')}</label>
        <input
          className="ark-input"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          onBlur={() => { if (draftFrom !== from) onUpdate(draftFrom, to); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('teamFollow.to')}</label>
        <ExitSelect value={to} exits={exits} onChange={(v) => onUpdate(from, v)} />
      </div>
    </div>
  );
}

function LinkAddForm({ exits, onConfirm, onCancel }: {
  exits: string[];
  onConfirm: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('arkadia');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(exits[0] ?? '');

  return (
    <div className="gps-entry gps-entry--add">
      <div className="gps-entry-header">
        <span className="gps-entry-index">{t('common.new')}</span>
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('teamFollow.from')}</label>
        <input
          className="ark-input"
          value={from}
          placeholder={t('teamFollow.fromPlaceholder')}
          onChange={(e) => setFrom(e.target.value)}
          autoFocus
        />
      </div>
      <div className="gps-field">
        <label className="gps-field-label">{t('teamFollow.to')}</label>
        <ExitSelect value={to} exits={exits} onChange={setTo} />
      </div>
      <div className="gps-add-actions">
        <button type="button" onClick={() => onConfirm(from, to)} disabled={!from.trim()}>{t('common.add')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

export function TeamFollowSection({ roomId, room, sceneRef }: RoomSectionProps) {
  const { t } = useTranslation('arkadia');
  useEditorState((s) => s.dataVersion);
  const raw = room.userData?.[TEAM_FOLLOW_KEY];
  const entries = parseLinks(raw);
  const exits = getExits(room);

  const [addOpen, setAddOpen] = useState(false);

  function commit(nextEntries: [string, string][]) {
    const currentRaw = room.userData?.[TEAM_FOLLOW_KEY] ?? null;
    const to = nextEntries.length > 0 ? serializeLinks(nextEntries) : null;
    if (currentRaw === to) return;
    pushCommand({ kind: 'setUserDataEntry', roomId, key: TEAM_FOLLOW_KEY, from: currentRaw, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  }

  function removeEntry(idx: number) {
    commit(parseLinks(room.userData?.[TEAM_FOLLOW_KEY]).filter((_, i) => i !== idx));
  }

  function updateEntry(idx: number, from: string, to: string) {
    commit(parseLinks(room.userData?.[TEAM_FOLLOW_KEY]).map((pair, i) => (i === idx ? [from, to] : pair)));
  }

  function addEntry(from: string, to: string) {
    const current = parseLinks(room.userData?.[TEAM_FOLLOW_KEY]);
    commit([...current, [from, to]]);
    setAddOpen(false);
  }

  if (exits.length === 0) return null;

  return (
    <>
      <h4>
        {t('teamFollow.title')}
        <img src={arkadiaLogo} alt="Arkadia" style={{ height: '2.5em', verticalAlign: 'middle', marginLeft: 6, marginTop: '-0.75em', marginBottom: '-0.75em' }} />
      </h4>
      <div className="gps-list">
        {entries.map(([from, to], idx) => (
          <LinkEntryCard
            key={idx}
            idx={idx}
            from={from}
            to={to}
            exits={exits}
            onUpdate={(f, tt) => updateEntry(idx, f, tt)}
            onRemove={() => removeEntry(idx)}
          />
        ))}
        {entries.length === 0 && !addOpen && (
          <div className="gps-empty">{t('teamFollow.empty')}</div>
        )}
        {addOpen && (
          <LinkAddForm
            exits={exits}
            onConfirm={addEntry}
            onCancel={() => setAddOpen(false)}
          />
        )}
        {!addOpen && (
          <button type="button" className="gps-add-btn" onClick={() => setAddOpen(true)}>{t('teamFollow.addButton')}</button>
        )}
      </div>
    </>
  );
}

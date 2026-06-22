import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorState } from 'mudlet-map-editor';
import { fetchChanges, fetchAreaChanges, type MapChange } from './changesApi';

type Target =
    | { kind: 'entity'; entityKey: string; title: string }
    | { kind: 'area'; areaId: number; title: string }
    | { kind: 'none' };

const CHANGE_COLORS: Record<string, string> = {
    added: '#a6e3a1',
    deleted: '#f38ba8',
    updated: '#89b4fa',
};

/** Normalize an mudlet-map-diff field entry into [from, to]. Shapes seen:
 *  { from, to }, { old, new }, [old, new], or a bare new value. */
function fromTo(val: unknown): [unknown, unknown] {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        const o = val as Record<string, unknown>;
        if ('from' in o || 'to' in o) return [o.from, o.to];
        if ('old' in o || 'new' in o) return [o.old, o.new];
    }
    if (Array.isArray(val) && val.length === 2) return [val[0], val[1]];
    return [undefined, val];
}

function fmt(v: unknown): string {
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (typeof v === 'object') {
        const s = JSON.stringify(v);
        return s.length > 80 ? s.slice(0, 77) + '…' : s;
    }
    const s = String(v);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

/** Recover a GitHub login from the change author: prefer the recorded actor,
 *  else parse a `…@users.noreply.github.com` commit email. */
function githubLogin(author?: { actor?: string; email?: string }): string | null {
    if (author?.actor) return author.actor;
    const m = author?.email?.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
    return m ? m[1] : null;
}

/** GitHub avatar from a login (no API call); hides itself if it fails to load. */
function Avatar({ login, alt }: { login: string; alt: string }) {
    const [ok, setOk] = useState(true);
    if (!ok) return null;
    return (
        <img
            src={`https://github.com/${login}.png?size=40`}
            alt={alt}
            title={alt}
            width={18}
            height={18}
            loading="lazy"
            onError={() => setOk(false)}
            style={{ borderRadius: '50%', flexShrink: 0 }}
        />
    );
}

export function ChangesTabLabel() {
    const { t } = useTranslation('arkadia');
    return <>{t('changes.tab')}</>;
}

export function ChangesTab() {
    const { t, i18n } = useTranslation('arkadia');
    const selection = useEditorState((s) => s.selection);
    const map = useEditorState((s) => s.map);
    const currentAreaId = useEditorState((s) => s.currentAreaId);
    const [changes, setChanges] = useState<MapChange[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [areaMode, setAreaMode] = useState(false);

    // Resolve what the current selection points at.
    let target: Target = { kind: 'none' };
    if (selection?.kind === 'room' && selection.ids.length === 1) {
        const id = selection.ids[0];
        const name = map?.rooms[id]?.name;
        target = { kind: 'entity', entityKey: `room:${id}`, title: name ? `#${id} · ${name}` : `#${id}` };
    } else if (selection?.kind === 'label') {
        const key = `label:${selection.areaId}-${selection.id}`;
        target = { kind: 'entity', entityKey: key, title: t('changes.labelTitle', { id: selection.id }) };
    }

    // In area mode (or when nothing specific is selected) fall back to the area history.
    const effective: Target =
        areaMode && currentAreaId != null
            ? { kind: 'area', areaId: currentAreaId, title: map?.areaNames?.[currentAreaId] ?? `#${currentAreaId}` }
            : target;

    const queryKey =
        effective.kind === 'entity' ? `e:${effective.entityKey}` :
        effective.kind === 'area' ? `a:${effective.areaId}` : '';

    useEffect(() => {
        if (!queryKey) { setChanges([]); setError(''); return; }
        let cancelled = false;
        setLoading(true);
        setError('');
        const p = effective.kind === 'entity'
            ? fetchChanges(effective.entityKey)
            : fetchAreaChanges((effective as { areaId: number }).areaId);
        p.then((data) => { if (!cancelled) setChanges(data); })
            .catch((e) => { if (!cancelled) setError(String(e)); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryKey]);

    const dateLocale = i18n.language === 'pl' ? 'pl-PL' : undefined;

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{t('changes.title')}</h3>
                {currentAreaId != null && (
                    <button
                        type="button"
                        onClick={() => setAreaMode((v) => !v)}
                        style={{ fontSize: '0.8em', padding: '2px 8px', color: areaMode ? '#a6e3a1' : undefined }}
                        title={t('changes.areaModeTitle')}
                    >
                        {t('changes.areaMode')}
                    </button>
                )}
            </div>

            <p className="hint" style={{ marginTop: 0, marginBottom: 12, wordBreak: 'break-word' }}>
                {effective.kind === 'none'
                    ? t('changes.selectHint')
                    : t(effective.kind === 'area' ? 'changes.showingArea' : 'changes.showingObject', { name: effective.title })}
            </p>

            {loading && <p className="hint">{t('changes.loading')}</p>}
            {error && <p className="hint" style={{ color: '#f38ba8', wordBreak: 'break-word' }}>{error}</p>}

            {!loading && !error && effective.kind !== 'none' && changes.length === 0 && (
                <p className="hint">{t('changes.empty')}</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {changes.map((c) => {
                    const color = CHANGE_COLORS[c.changeType] ?? '#a6adc8';
                    const date = c.timestamp ? new Date(c.timestamp).toLocaleDateString(dateLocale) : '';
                    const who = c.author?.name || c.author?.actor || '';
                    const login = githubLogin(c.author);
                    const fields = c.changes ? Object.entries(c.changes) : [];
                    return (
                        <div key={c._id} style={{ padding: '8px 10px', background: '#1e1e2e', borderRadius: 6, border: '1px solid #313244' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <span style={{ fontSize: '0.72em', fontWeight: 'bold', textTransform: 'uppercase', color, letterSpacing: '0.04em' }}>
                                    {t(`changes.type.${c.changeType}`)}
                                </span>
                                {areaMode && (
                                    <span style={{ fontSize: '0.75em', color: '#a6adc8' }}>{c.entityKey}</span>
                                )}
                                <span style={{ marginLeft: 'auto', fontSize: '0.75em', color: '#6c7086' }}>{c.version}</span>
                            </div>

                            {c.context?.name && !c.entityKey.startsWith('label') && (
                                <div style={{ fontSize: '0.8em', color: '#cdd6f4', marginBottom: 4 }}>{c.context.name}</div>
                            )}
                            {c.context?.text && (
                                <div style={{ fontSize: '0.8em', color: '#cdd6f4', marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.context.text}</div>
                            )}

                            {c.changeType === 'updated' && fields.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                                    {fields.map(([field, val]) => {
                                        const [from, to] = fromTo(val);
                                        return (
                                            <div key={field} style={{ fontSize: '0.78em', fontFamily: 'monospace', color: '#89b4fa', paddingLeft: 6, wordBreak: 'break-word' }}>
                                                <span style={{ color: '#a6adc8' }}>{field}</span>: {from !== undefined ? `${fmt(from)} → ${fmt(to)}` : fmt(to)}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: '0.75em', color: '#6c7086' }}>
                                {login && <Avatar login={login} alt={who || login} />}
                                <span>{who}{who && date ? ' · ' : ''}{date}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

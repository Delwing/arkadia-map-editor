import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { loadUrlIntoStore, getMapBytes } from 'mudlet-map-editor';
import { clearToken, startOAuth } from './auth';
import { getUser, getOpenPRs, getMasterSha, createBranch, getFileSha, uploadFile, createPR, updatePR, uint8ToBase64, getLatestRelease, getProxiedMapUrl, getProxiedBranchMapUrl, getPRChecks, getPRReviews, getRequiredApprovals, BRANCH, OpenPR, CheckRun, Review } from './api';
import { acquireLock, releaseLock, getLockStatus } from './lock';
import { store } from 'mudlet-map-editor';
import { subscribe, getToken, getSavedBytes, getHasLock, setHasLock, setSavedBytes, getMapVersion, getLockOwner, setLockOwner, getNotes, setNotes } from './state';
import { fetchNotes, deleteNote } from './notesApi';

function checkIcon(run: CheckRun): { symbol: string; color: string } {
    if (run.status !== 'completed') return { symbol: '●', color: '#f9e2af' };
    switch (run.conclusion) {
        case 'success':  return { symbol: '✓', color: '#a6e3a1' };
        case 'skipped':
        case 'neutral':  return { symbol: '–', color: '#6c7086' };
        default:         return { symbol: '✗', color: '#f38ba8' };
    }
}

function latestReviewPerUser(reviews: Review[]): Review[] {
    const map = new Map<string, Review>();
    for (const r of reviews) {
        if (r.state === 'COMMENTED') continue;
        map.set(r.user.login, r);
    }
    return Array.from(map.values());
}

function PRDetails({ checks, reviews, requiredApprovals }: { checks: CheckRun[]; reviews: Review[]; requiredApprovals: number | null }) {
    const { t } = useTranslation('arkadia');
    const latestReviews = latestReviewPerUser(reviews);
    const approved = latestReviews.filter(r => r.state === 'APPROVED');
    const changesRequested = latestReviews.filter(r => r.state === 'CHANGES_REQUESTED');
    const approvalsMet = requiredApprovals !== null && approved.length >= requiredApprovals;
    const approvalsColor = changesRequested.length > 0 ? '#f38ba8' : approvalsMet ? '#a6e3a1' : '#f9e2af';

    return (
        <div style={{ fontSize: '0.82em', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {checks.length > 0 && (
                <div>
                    {checks.map(run => {
                        const { symbol, color } = checkIcon(run);
                        return (
                            <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color, fontWeight: 'bold', width: 12, textAlign: 'center', flexShrink: 0 }}>{symbol}</span>
                                <a href={run.html_url} target="_blank" rel="noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {run.name}
                                </a>
                            </div>
                        );
                    })}
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: approvalsColor, fontWeight: 'bold', width: 12, textAlign: 'center', flexShrink: 0 }}>
                    {changesRequested.length > 0 ? '✗' : approvalsMet ? '✓' : '●'}
                </span>
                <span style={{ color: approvalsColor }}>
                    {t('sync.approvals', { count: approved.length })}{requiredApprovals !== null ? ` / ${requiredApprovals}` : ''}
                </span>
            </div>
            {(approved.length > 0 || changesRequested.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 18 }}>
                    {approved.map(r => (
                        <span key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a6e3a1' }}>
                            <img src={r.user.avatar_url} alt="" width={14} height={14} style={{ borderRadius: '50%' }} />
                            {r.user.login}
                        </span>
                    ))}
                    {changesRequested.map(r => (
                        <span key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f38ba8' }}>
                            <img src={r.user.avatar_url} alt="" width={14} height={14} style={{ borderRadius: '50%' }} />
                            {r.user.login} ({t('sync.changesRequested')})
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

interface OpenPRViewProps {
    pr: OpenPR;
    isMyPR: boolean;
    checks: CheckRun[];
    reviews: Review[];
    requiredApprovals: number | null;
    savedBytes: Uint8Array | null;
    hasLock: boolean;
    busy: boolean;
    prMessage: string;
    onPrMessageChange: (v: string) => void;
    onFetchBranch: () => void;
    onSave: () => void;
    onUpdate: () => void;
    onRelease: () => void;
}

function OpenPRView({ pr, isMyPR, checks, reviews, requiredApprovals, savedBytes, hasLock, busy, prMessage, onPrMessageChange, onFetchBranch, onSave, onUpdate, onRelease }: OpenPRViewProps) {
    const { t } = useTranslation('arkadia');
    return (
        <div>
            <div style={{ marginBottom: 16 }}>
                <p className="hint" style={{ color: isMyPR ? '#ffd080' : undefined, marginBottom: 8 }}>
                    {isMyPR
                        ? t('sync.yourPrOpen')
                        : <Trans i18nKey="sync.otherPrOpen" ns="arkadia" values={{ user: pr.user.login }} components={[<span />, <strong />]} />
                    }
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <a href={pr.html_url} target="_blank" rel="noreferrer" className="hint"
                        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{pr.number} {pr.title}
                    </a>
                    <button type="button" disabled={busy} onClick={onFetchBranch} style={{ flexShrink: 0 }}>
                        {t('sync.fetchFromPR')}
                    </button>
                </div>
                <PRDetails checks={checks} reviews={reviews} requiredApprovals={requiredApprovals} />
            </div>
            {isMyPR && (
                <div style={{ borderTop: '1px solid #313244', paddingTop: 14 }}>
                    <p className="hint" style={{ color: savedBytes ? '#a6e3a1' : undefined, marginBottom: 8 }}>
                        {savedBytes ? t('sync.stagedReady') : t('sync.stageToUpdate')}
                    </p>
                    <button type="button" disabled={busy} onClick={onSave} style={{ marginBottom: 8 }}>
                        {t('sync.saveMap')}
                    </button>
                    <div className="field" style={{ marginBottom: 8 }}>
                        <textarea
                            placeholder={t('sync.prDescriptionPlaceholder')}
                            value={prMessage}
                            onChange={(e) => onPrMessageChange(e.target.value)}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" disabled={busy || !savedBytes} onClick={onUpdate}>
                            {t('sync.updatePR')}
                        </button>
                        {hasLock && (
                            <button type="button" disabled={busy} onClick={onRelease}>
                                {t('sync.releaseLock')}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

const HOUR = 1000 * 60 * 60;
const LOCK_DURATIONS = [
    { key: 'lockDuration1h' as const, duration: HOUR },
    { key: 'lockDuration2h' as const, duration: HOUR * 2 },
    { key: 'lockDuration4h' as const, duration: HOUR * 4 },
    { key: 'lockDuration8h' as const, duration: HOUR * 8 },
];

export function GitHubPanel() {
    const { t } = useTranslation('arkadia');
    const [, rerender] = useState(0);
    const [user, setUser] = useState<{ login: string; avatar_url: string } | null>(null);
    const [latestRelease, setLatestRelease] = useState<string | null>(null);
    const [existingPR, setExistingPR] = useState<OpenPR | null>(null);
    const [checks, setChecks] = useState<CheckRun[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [requiredApprovals, setRequiredApprovals] = useState<number | null>(null);
    const [prMessage, setPrMessage] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    const token = getToken();
    const mapVersion = getMapVersion();
    const hasLock = getHasLock();
    const savedBytes = getSavedBytes();
    const lockOwner = getLockOwner();
    const versionMatch = mapVersion != null && latestRelease != null && mapVersion === latestRelease;
    const isMyPR = user != null && existingPR != null && existingPR.user.login === user.login;

    useEffect(() => {
        if (!token) { setUser(null); return; }
        getUser(token).then(setUser).catch(() => clearToken());
    }, [token]);

    useEffect(() => {
        getLatestRelease().then(setLatestRelease);
    }, []);

    useEffect(() => {
        getLockStatus().then(s => setLockOwner(s.locked ? { user: s.user, expiresAt: s.expiresAt } : null));
    }, []);

    useEffect(() => {
        if (!token) { setExistingPR(null); return; }
        getOpenPRs(token).then(prs => setExistingPR(prs[0] ?? null));
    }, [token]);

    useEffect(() => {
        if (!token) return;
        getRequiredApprovals(token).then(setRequiredApprovals);
    }, [token]);

    useEffect(() => {
        if (!token || !existingPR) { setChecks([]); setReviews([]); return; }
        getPRChecks(token, existingPR.head.sha).then(setChecks);
        getPRReviews(token, existingPR.number).then(setReviews);
    }, [token, existingPR?.number, existingPR?.head.sha]);

    const handleSave = async () => {
        const bytes = await getMapBytes();
        if (!bytes) { setStatus(t('sync.noMapLoaded')); return; }
        setSavedBytes(bytes);
        setStatus(t('sync.mapStaged'));
    };

    const refreshLockStatus = () =>
        getLockStatus().then(s => setLockOwner(s.locked ? { user: s.user, expiresAt: s.expiresAt } : null));

    const handleLock = async (duration: number) => {
        if (!token) return;
        setBusy(true);
        setStatus(t('sync.acquiringLock'));
        try {
            const res = await acquireLock(token, duration);
            setStatus(res.message);
            if (res.result) {
                setHasLock(true);
                fetchNotes().then(setNotes);
            }
        } catch (e) {
            setStatus(String(e));
        } finally {
            await refreshLockStatus();
            setBusy(false);
        }
    };

    const handleRelease = async () => {
        if (!token) return;
        setBusy(true);
        setStatus(t('sync.releasingLock'));
        try {
            const res = await releaseLock(token);
            setStatus(res.message);
            setHasLock(false);
        } catch (e) {
            setStatus(String(e));
        } finally {
            await refreshLockStatus();
            setBusy(false);
        }
    };

    const handleUpload = async () => {
        if (!token || !savedBytes) return;
        setBusy(true);
        setStatus(t('sync.checkingPRs'));
        try {
            const prs = await getOpenPRs(token);
            if (prs.length > 0) {
                setExistingPR(prs[0]);
                setStatus(t('sync.prAlreadyExists'));
                return;
            }

            setStatus(t('sync.creatingBranch'));
            const masterSha = await getMasterSha(token);
            try {
                await createBranch(token, masterSha);
            } catch (e: any) {
                setStatus(t('sync.branchError', { error: e.message }));
                return;
            }

            setStatus(t('sync.uploadingMap'));
            const fileSha = await getFileSha(token, masterSha);
            await uploadFile(token, uint8ToBase64(savedBytes), fileSha);

            setStatus(t('sync.creatingPR'));
            await createPR(token, prMessage || 'Map update', prMessage);
            const freshPRs = await getOpenPRs(token);
            setExistingPR(freshPRs[0] ?? null);
            setStatus(t('sync.prCreated'));

            await releaseLock(token);
            setHasLock(false);
            setPrMessage('');

            const appliedNotes = getNotes().filter((n) => n.commandsJson);
            if (appliedNotes.length > 0) {
                await Promise.allSettled(appliedNotes.map((n) => deleteNote(token, n.id)));
                setNotes(await fetchNotes());
            }
        } catch (e) {
            setStatus(t('sync.error', { error: String(e) }));
        } finally {
            setBusy(false);
        }
    };

    const handleUpdate = async () => {
        if (!token || !savedBytes || !existingPR) return;
        setBusy(true);
        setStatus(t('sync.uploadingMap'));
        try {
            const fileSha = await getFileSha(token, BRANCH);
            await uploadFile(token, uint8ToBase64(savedBytes), fileSha, prMessage || 'update map');

            if (prMessage) {
                setStatus(t('sync.updatingPR'));
                await updatePR(token, existingPR.number, existingPR.title, prMessage);
            }

            setStatus(t('sync.prUpdated'));
            setPrMessage('');
            if (token) getOpenPRs(token).then(prs => setExistingPR(prs[0] ?? null));
        } catch (e) {
            setStatus(t('sync.error', { error: String(e) }));
        } finally {
            setBusy(false);
        }
    };

    if (!token) {
        return (
            <>
                <h3>{t('sync.title')}</h3>
                {lockOwner && (
                    <p className="hint" style={{ color: '#ffd080' }}>
                        <Trans
                            i18nKey="sync.lockHeldBy"
                            ns="arkadia"
                            values={{ user: lockOwner.user, time: new Date(lockOwner.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                            components={[<span />, <strong />]}
                        />
                    </p>
                )}
                <p className="hint">{t('sync.loginHint')}</p>
                <button type="button" onClick={startOAuth}>{t('sync.loginButton')}</button>
            </>
        );
    }

    return (
        <>
            <h3>{t('sync.title')}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {user
                    ? <img src={user.avatar_url} alt="" width={24} height={24} style={{ borderRadius: '50%', flexShrink: 0 }} />
                    : <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#444', flexShrink: 0 }} />
                }
                <span>{user?.login ?? ''}</span>
                <button type="button" style={{ marginLeft: 'auto' }} onClick={() => { clearToken(); setHasLock(false); }}>
                    {t('sync.logout')}
                </button>
            </div>

            <div style={{ marginBottom: 12, fontSize: '0.85em' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <div>{t('sync.mapVersion')} <strong>{mapVersion ?? '—'}</strong></div>
                        <div>{t('sync.latestRelease')} <strong>{latestRelease ?? '…'}</strong></div>
                    </div>
                    <button type="button" disabled={busy} onClick={async () => {
                        setBusy(true);
                        setStatus(t('sync.fetchingLatestMap'));
                        try {
                            await loadUrlIntoStore(getProxiedMapUrl());
                            setStatus(t('sync.mapLoaded'));
                        } catch (e) {
                            setStatus(t('sync.fetchFailed', { error: String(e) }));
                        } finally {
                            setBusy(false);
                        }
                    }}>
                        {t('sync.fetch')}
                    </button>
                </div>
                {lockOwner && (
                    <p className="hint" style={{ color: '#ffd080', marginTop: 4 }}>
                        <Trans
                            i18nKey="sync.lockHeldBy"
                            ns="arkadia"
                            values={{ user: lockOwner.user, time: new Date(lockOwner.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                            components={[<span />, <strong />]}
                        />
                    </p>
                )}
                {mapVersion && latestRelease && !versionMatch && (
                    <p className="hint" style={{ color: '#f38ba8', marginTop: 4 }}>
                        {t('sync.versionMismatch')}
                    </p>
                )}
            </div>

            {existingPR ? (
                <OpenPRView
                    pr={existingPR}
                    isMyPR={isMyPR}
                    checks={checks}
                    reviews={reviews}
                    requiredApprovals={requiredApprovals}
                    savedBytes={savedBytes}
                    hasLock={hasLock}
                    busy={busy}
                    prMessage={prMessage}
                    onPrMessageChange={setPrMessage}
                    onFetchBranch={async () => {
                        setBusy(true);
                        setStatus(t('sync.fetchingBranchMap'));
                        try {
                            await loadUrlIntoStore(getProxiedBranchMapUrl());
                            setStatus(t('sync.branchMapLoaded'));
                        } catch (e) {
                            setStatus(t('sync.fetchFailed', { error: String(e) }));
                        } finally {
                            setBusy(false);
                        }
                    }}
                    onSave={handleSave}
                    onUpdate={handleUpdate}
                    onRelease={handleRelease}
                />
            ) : !hasLock ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {LOCK_DURATIONS.map((opt) => (
                        <button key={opt.key} type="button" disabled={busy || !versionMatch} onClick={() => handleLock(opt.duration)}>
                            {t('sync.lockFor', { duration: t(`sync.${opt.key}` as any) })}
                        </button>
                    ))}
                </div>
            ) : (
                <>
                    {(() => {
                        const pending = getNotes().filter((n) => n.commandsJson);
                        return pending.length > 0 ? (
                            <div style={{ marginBottom: 12, padding: '8px 10px', background: '#2a2040', border: '1px solid #cba6f7', borderRadius: 6 }}>
                                <p style={{ margin: '0 0 6px', color: '#cba6f7', fontWeight: 'bold', fontSize: '0.9em' }}>
                                    {t('sync.pendingNotesTitle', { count: pending.length })}
                                </p>
                                <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: '0.85em', color: '#cdd6f4', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {pending.map((n) => (
                                        <li key={n.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            #{n.roomId} — {n.text}
                                        </li>
                                    ))}
                                </ul>
                                <button type="button" style={{ fontSize: '0.85em' }} onClick={() => store.setState({ sidebarTab: 'notes' })}>
                                    {t('sync.goToNotes')}
                                </button>
                            </div>
                        ) : null;
                    })()}
                    <p className="hint" style={{ color: '#ffd080', marginBottom: 8 }}>
                        {t('sync.lockActive')}{savedBytes ? ` ${t('sync.stagedReadyUpload')}` : ` ${t('sync.stageToUpload')}`}
                    </p>
                    <button type="button" disabled={busy} onClick={handleSave} style={{ marginBottom: 8 }}>
                        {t('sync.saveMap')}
                    </button>
                    <div className="field" style={{ marginBottom: 4 }}>
                        <textarea
                            placeholder={t('sync.prDescriptionOnlyPlaceholder')}
                            value={prMessage}
                            onChange={(e) => setPrMessage(e.target.value)}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                        />
                    </div>
                    <button type="button" disabled={busy || !savedBytes} onClick={handleUpload} style={{ marginBottom: 4 }}>
                        {t('sync.uploadCreatePR')}
                    </button>
                    <button type="button" disabled={busy} onClick={handleRelease}>
                        {t('sync.releaseWithoutUpload')}
                    </button>
                </>
            )}

            {status && <p className="hint" style={{ marginTop: 12, wordBreak: 'break-word' }}>{status}</p>}
        </>
    );
}

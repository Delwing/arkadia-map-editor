import { useEffect, useState } from 'react';
import { loadUrlIntoStore, getMapBytes } from 'mudlet-map-editor';
import { clearToken, startOAuth } from './auth';
import { getUser, getOpenPRs, getMasterSha, createBranch, getFileSha, uploadFile, createPR, updatePR, uint8ToBase64, getLatestRelease, getProxiedMapUrl, getProxiedBranchMapUrl, getPRChecks, getPRReviews, getRequiredApprovals, BRANCH, OpenPR, CheckRun, Review } from './api';
import { acquireLock, releaseLock, getLockStatus } from './lock';
import { subscribe, getToken, getSavedBytes, getHasLock, setHasLock, setSavedBytes, getMapVersion, getLockOwner, setLockOwner } from './state';

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
                    {approved.length}{requiredApprovals !== null ? ` / ${requiredApprovals}` : ''} approval{requiredApprovals !== 1 ? 's' : ''}
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
                            {r.user.login} (changes requested)
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
    return (
        <div>
            <div style={{ marginBottom: 16 }}>
                <p className="hint" style={{ color: isMyPR ? '#ffd080' : undefined, marginBottom: 8 }}>
                    {isMyPR ? 'Your PR is open — locking is disabled.' : <>Open PR from <strong>{pr.user.login}</strong> — locking is disabled.</>}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <a href={pr.html_url} target="_blank" rel="noreferrer" className="hint"
                        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{pr.number} {pr.title}
                    </a>
                    <button type="button" disabled={busy} onClick={onFetchBranch} style={{ flexShrink: 0 }}>
                        Fetch from PR
                    </button>
                </div>
                <PRDetails checks={checks} reviews={reviews} requiredApprovals={requiredApprovals} />
            </div>
            {isMyPR && (
                <div style={{ borderTop: '1px solid #313244', paddingTop: 14 }}>
                    <p className="hint" style={{ color: savedBytes ? '#a6e3a1' : undefined, marginBottom: 8 }}>
                        {savedBytes ? 'Map staged — ready to update.' : 'Stage the map to enable update.'}
                    </p>
                    <button type="button" disabled={busy} onClick={onSave} style={{ marginBottom: 8 }}>
                        Save map
                    </button>
                    <div className="field" style={{ marginBottom: 8 }}>
                        <textarea
                            placeholder="Commit message / PR description (optional)"
                            value={prMessage}
                            onChange={(e) => onPrMessageChange(e.target.value)}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" disabled={busy || !savedBytes} onClick={onUpdate}>
                            Update PR
                        </button>
                        {hasLock && (
                            <button type="button" disabled={busy} onClick={onRelease}>
                                Release lock
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

const HOUR = 1000 * 60 * 60;
const LOCK_OPTIONS = [
    { label: '1 hour',   duration: HOUR },
    { label: '2 hours',  duration: HOUR * 2 },
    { label: '4 hours',  duration: HOUR * 4 },
    { label: '8 hours',  duration: HOUR * 8 },
];

export function GitHubPanel() {
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

    const handleSave = () => {
        const bytes = getMapBytes();
        if (!bytes) { setStatus('No map loaded.'); return; }
        setSavedBytes(bytes);
        setStatus('Map staged for upload.');
    };

    const refreshLockStatus = () =>
        getLockStatus().then(s => setLockOwner(s.locked ? { user: s.user, expiresAt: s.expiresAt } : null));

    const handleLock = async (duration: number) => {
        if (!token) return;
        setBusy(true);
        setStatus('Acquiring lock…');
        try {
            const res = await acquireLock(token, duration);
            setStatus(res.message);
            if (res.result) setHasLock(true);
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
        setStatus('Releasing lock…');
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
        setStatus('Checking for open PRs…');
        try {
            const prs = await getOpenPRs(token);
            if (prs.length > 0) {
                setExistingPR(prs[0]);
                setStatus('An open PR already exists.');
                return;
            }

            setStatus('Creating branch…');
            const masterSha = await getMasterSha(token);
            try {
                await createBranch(token, masterSha);
            } catch (e: any) {
                setStatus(`Branch error: ${e.message}`);
                return;
            }

            setStatus('Uploading map…');
            const fileSha = await getFileSha(token, masterSha);
            await uploadFile(token, uint8ToBase64(savedBytes), fileSha);

            setStatus('Creating PR…');
            await createPR(token, prMessage || 'Map update', prMessage);
            const freshPRs = await getOpenPRs(token);
            setExistingPR(freshPRs[0] ?? null);
            setStatus('PR created.');

            await releaseLock(token);
            setHasLock(false);
            setPrMessage('');
        } catch (e) {
            setStatus(`Error: ${String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    const handleUpdate = async () => {
        if (!token || !savedBytes || !existingPR) return;
        setBusy(true);
        setStatus('Uploading map…');
        try {
            const fileSha = await getFileSha(token, BRANCH);
            await uploadFile(token, uint8ToBase64(savedBytes), fileSha, prMessage || 'update map');

            if (prMessage) {
                setStatus('Updating PR…');
                await updatePR(token, existingPR.number, existingPR.title, prMessage);
            }

            setStatus('PR updated.');
            setPrMessage('');
            // refresh PR after new commit — head SHA changes so checks will reset
            if (token) getOpenPRs(token).then(prs => setExistingPR(prs[0] ?? null));
        } catch (e) {
            setStatus(`Error: ${String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    if (!token) {
        return (
            <div className="panel-content">
                <h3>Arkadia Sync</h3>
                {lockOwner && (
                    <p className="hint" style={{ color: '#ffd080' }}>
                        Lock held by <strong>{lockOwner.user}</strong> until {new Date(lockOwner.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                )}
                <p className="hint">Login to acquire a lock and submit map updates.</p>
                <button type="button" onClick={startOAuth}>Login with GitHub</button>
            </div>
        );
    }

    return (
        <div className="panel-content">
            <h3>Arkadia Sync</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {user
                    ? <img src={user.avatar_url} alt="" width={24} height={24} style={{ borderRadius: '50%', flexShrink: 0 }} />
                    : <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#444', flexShrink: 0 }} />
                }
                <span>{user?.login ?? ''}</span>
                <button type="button" style={{ marginLeft: 'auto' }} onClick={() => { clearToken(); setHasLock(false); }}>
                    Logout
                </button>
            </div>

            <div style={{ marginBottom: 12, fontSize: '0.85em' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <div>Map version: <strong>{mapVersion ?? '—'}</strong></div>
                        <div>Latest release: <strong>{latestRelease ?? '…'}</strong></div>
                    </div>
                    <button type="button" disabled={busy} onClick={async () => {
                        setBusy(true);
                        setStatus('Fetching latest map…');
                        try {
                            await loadUrlIntoStore(getProxiedMapUrl());
                            setStatus('Map loaded.');
                        } catch (e) {
                            setStatus(`Fetch failed: ${String(e)}`);
                        } finally {
                            setBusy(false);
                        }
                    }}>
                        Fetch
                    </button>
                </div>
                {lockOwner && (
                    <p className="hint" style={{ color: '#ffd080', marginTop: 4 }}>
                        Lock held by <strong>{lockOwner.user}</strong> until {new Date(lockOwner.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                )}
                {mapVersion && latestRelease && !versionMatch && (
                    <p className="hint" style={{ color: '#f38ba8', marginTop: 4 }}>
                        Version mismatch — fetch the latest map before locking.
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
                        setStatus('Fetching branch map…');
                        try {
                            await loadUrlIntoStore(getProxiedBranchMapUrl());
                            setStatus('Branch map loaded.');
                        } catch (e) {
                            setStatus(`Fetch failed: ${String(e)}`);
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
                    {LOCK_OPTIONS.map((opt) => (
                        <button key={opt.label} type="button" disabled={busy || !versionMatch} onClick={() => handleLock(opt.duration)}>
                            Lock for {opt.label}
                        </button>
                    ))}
                </div>
            ) : (
                <>
                    <p className="hint" style={{ color: '#ffd080', marginBottom: 8 }}>
                        Lock active.{savedBytes ? ' Map staged — ready to upload.' : ' Stage the map to enable upload.'}
                    </p>
                    <button type="button" disabled={busy} onClick={handleSave} style={{ marginBottom: 8 }}>
                        Save map
                    </button>
                    <div className="field" style={{ marginBottom: 4 }}>
                        <textarea
                            placeholder="PR description (optional)"
                            value={prMessage}
                            onChange={(e) => setPrMessage(e.target.value)}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                        />
                    </div>
                    <button type="button" disabled={busy || !savedBytes} onClick={handleUpload} style={{ marginBottom: 4 }}>
                        Upload &amp; create PR
                    </button>
                    <button type="button" disabled={busy} onClick={handleRelease}>
                        Release lock without uploading
                    </button>
                </>
            )}

            {status && <p className="hint" style={{ marginTop: 12, wordBreak: 'break-word' }}>{status}</p>}
        </div>
    );
}

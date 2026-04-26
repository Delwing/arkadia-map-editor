import { useEffect, useState } from 'react';
import { loadUrlIntoStore, getMapBytes } from 'mudlet-map-editor';
import { clearToken, startOAuth } from './auth';
import { getUser, getOpenPRs, getMasterSha, createBranch, getFileSha, uploadFile, createPR, updatePR, uint8ToBase64, getLatestRelease, getProxiedMapUrl, BRANCH, OpenPR } from './api';
import { acquireLock, releaseLock } from './lock';
import { subscribe, getToken, getSavedBytes, getHasLock, setHasLock, setSavedBytes, getMapVersion } from './state';

const HOUR = 1000 * 60 * 60;
const LOCK_OPTIONS = [
    { label: 'Lock for 1h', duration: HOUR },
    { label: 'Lock for 2h', duration: HOUR * 2 },
    { label: 'Lock for 4h', duration: HOUR * 4 },
    { label: 'Lock for 8h', duration: HOUR * 8 },
];

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

function GitHubIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0a8 8 0 00-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.2 0 0 .7-.2 2.2.8a7.6 7.6 0 014 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 2 .1 2.2.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.3c0 .2.1.5.6.4A8 8 0 008 0z"/>
        </svg>
    );
}

function UnlockIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3.5" y="7.5" width="9" height="6" rx="1"/>
            <path d="M5.5 7.5V5a2.5 2.5 0 015-.5"/>
        </svg>
    );
}

function WarnIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 2l6 11H2z"/>
            <path d="M8 7v3M8 12v.5"/>
        </svg>
    );
}

export function GitHubPanel() {
    const [, rerender] = useState(0);
    const [user, setUser] = useState<{ login: string; avatar_url: string } | null>(null);
    const [latestRelease, setLatestRelease] = useState<string | null>(null);
    const [existingPR, setExistingPR] = useState<OpenPR | null>(null);
    const [prMessage, setPrMessage] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [lockExpiresAt, setLockExpiresAt] = useState<number | null>(null);
    const [lockAcquiredFor, setLockAcquiredFor] = useState<number>(HOUR * 2);
    const [now, setNow] = useState(Date.now());

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const token = getToken();
    const mapVersion = getMapVersion();
    const hasLock = getHasLock();
    const savedBytes = getSavedBytes();
    const versionMatch = mapVersion != null && latestRelease != null && mapVersion === latestRelease;
    const versionMismatch = mapVersion != null && latestRelease != null && !versionMatch;
    const isMyPR = user != null && existingPR != null && existingPR.user.login === user.login;

    const lockRemaining = lockExpiresAt != null ? Math.max(0, lockExpiresAt - now) : 0;
    const lockMins = Math.floor(lockRemaining / 60000);
    const lockSecs = Math.floor((lockRemaining % 60000) / 1000);
    const lockTimeStr = lockMins > 0 ? `${lockMins}m` : `${lockSecs}s`;
    const lockLow = lockRemaining < 10 * 60 * 1000;
    const ringDash = lockExpiresAt ? (lockRemaining / lockAcquiredFor) * RING_C : 0;

    const initials = user?.login?.slice(0, 2).toUpperCase() ?? '?';

    useEffect(() => {
        if (!token) { setUser(null); return; }
        getUser(token).then(setUser).catch(() => clearToken());
    }, [token]);

    useEffect(() => {
        getLatestRelease().then(setLatestRelease);
    }, []);

    useEffect(() => {
        if (!token) { setExistingPR(null); return; }
        getOpenPRs(token).then(prs => setExistingPR(prs[0] ?? null));
    }, [token]);

    const handleSave = () => {
        const bytes = getMapBytes();
        if (!bytes) { setStatus('No map loaded.'); return; }
        setSavedBytes(bytes);
        setStatus('Map staged for upload.');
    };

    const handleLock = async (duration: number) => {
        if (!token) return;
        setBusy(true);
        setStatus('Acquiring lock…');
        try {
            const res = await acquireLock(token, duration);
            setStatus(res.message);
            if (res.result) {
                setHasLock(true);
                setLockExpiresAt(Date.now() + duration);
                setLockAcquiredFor(duration);
            }
        } catch (e) {
            setStatus(String(e));
        } finally {
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
            setLockExpiresAt(null);
        } catch (e) {
            setStatus(String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleFetch = async () => {
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
            const pr = await createPR(token, prMessage || 'Map update', prMessage);
            setExistingPR({ number: pr.number, html_url: pr.html_url, title: prMessage || 'Map update', user: { login: user!.login } });
            setStatus('PR created.');

            await releaseLock(token);
            setHasLock(false);
            setLockExpiresAt(null);
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
        } catch (e) {
            setStatus(`Error: ${String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="panel-content ark-sync-panel">
            <div className="ark-sync-head">
                <GitHubIcon />
                <div className="ark-sync-title">Arkadia Sync</div>
            </div>

            {!token ? (
                <>
                    <p className="hint">Login to acquire a lock and submit map updates.</p>
                    <button type="button" onClick={startOAuth}>Login with GitHub</button>
                </>
            ) : (
                <>
                    <div className="ark-sync-user">
                        {user?.avatar_url
                            ? <img src={user.avatar_url} alt="" width={28} height={28} className="ark-sync-avatar ark-sync-avatar--img" />
                            : <div className="ark-sync-avatar">{initials}</div>
                        }
                        <div className="ark-sync-userinfo">
                            <span className="ark-sync-login">{user?.login ?? '…'}</span>
                            <span className="ark-sync-org">Delwing/arkadia-mapa · development</span>
                        </div>
                        <button type="button" className="ark-sync-logout" onClick={() => { clearToken(); setHasLock(false); setLockExpiresAt(null); }}>
                            Logout
                        </button>
                    </div>

                    <div className={`ark-versions${versionMismatch ? ' ark-versions--warn' : ''}`}>
                        <div className="ark-version">
                            <span className="ark-version-label">Loaded</span>
                            <span className="ark-version-value">{mapVersion ?? '—'}</span>
                        </div>
                        <span className={`ark-versions-arrow${versionMismatch ? ' ark-versions-arrow--warn' : ''}`}>
                            {versionMismatch ? <WarnIcon /> : '→'}
                        </span>
                        <div className="ark-version ark-version--right">
                            <span className="ark-version-label">Latest</span>
                            <span className="ark-version-value">{latestRelease ?? '…'}</span>
                        </div>
                    </div>

                    {versionMismatch && (
                        <button type="button" className="ark-fetch-btn" disabled={busy} onClick={handleFetch}>
                            Fetch latest map
                        </button>
                    )}

                    {!existingPR && (hasLock && lockExpiresAt ? (
                        <div className="ark-lock-card">
                            <div className="ark-lock-ring">
                                <svg width="44" height="44" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
                                    <circle cx="22" cy="22" r={RING_R} className="ark-lock-ring-bg" />
                                    <circle
                                        cx="22" cy="22" r={RING_R}
                                        className={`ark-lock-ring-fg${lockLow ? ' ark-lock-ring-fg--warn' : ''}`}
                                        strokeDasharray={`${ringDash} ${RING_C}`}
                                    />
                                </svg>
                                <span className="ark-lock-time">{lockTimeStr}</span>
                            </div>
                            <div className="ark-lock-info">
                                <span className="ark-lock-status">Lock active</span>
                                <span className="ark-lock-meta">
                                    Expires {new Date(lockExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <button type="button" className="ark-lock-release" disabled={busy} onClick={handleRelease} title="Release lock">
                                <UnlockIcon />
                            </button>
                        </div>
                    ) : (
                        <div className="ark-lockpicker">
                            {LOCK_OPTIONS.map((opt) => (
                                <button
                                    key={opt.label}
                                    type="button"
                                    disabled={busy || !versionMatch}
                                    onClick={() => handleLock(opt.duration)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    ))}

                    {hasLock && (
                        <>
                            {existingPR ? (
                                isMyPR ? (
                                    <>
                                        <p className="hint" style={{ color: '#ffd080', marginBottom: 4 }}>
                                            Your PR is open.
                                        </p>
                                        <a href={existingPR.html_url} target="_blank" rel="noreferrer" className="hint"
                                            style={{ display: 'block', marginBottom: 8, wordBreak: 'break-all' }}>
                                            {existingPR.html_url}
                                        </a>
                                        <button type="button" disabled={busy} onClick={handleSave} style={{ marginBottom: 8 }}>
                                            Save map
                                        </button>
                                        <div className="field" style={{ marginBottom: 4 }}>
                                            <textarea
                                                placeholder="Commit message / PR description (optional)"
                                                value={prMessage}
                                                onChange={(e) => setPrMessage(e.target.value)}
                                                rows={3}
                                                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                                            />
                                        </div>
                                        <button type="button" disabled={busy || !savedBytes} onClick={handleUpdate} style={{ marginBottom: 4 }}>
                                            Update PR
                                        </button>
                                        <button type="button" disabled={busy} onClick={handleRelease}>
                                            Release lock
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p className="hint" style={{ marginBottom: 4 }}>
                                            An open PR from <strong>{existingPR.user.login}</strong> exists.
                                        </p>
                                        <a href={existingPR.html_url} target="_blank" rel="noreferrer" className="hint"
                                            style={{ display: 'block', wordBreak: 'break-all' }}>
                                            {existingPR.html_url}
                                        </a>
                                    </>
                                )
                            ) : (
                                <>
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
                        </>
                    )}

                    {status && <p className="hint" style={{ marginTop: 12, wordBreak: 'break-word' }}>{status}</p>}
                </>
            )}
        </div>
    );
}

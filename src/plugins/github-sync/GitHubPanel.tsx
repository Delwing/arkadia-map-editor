import { useEffect, useState } from 'react';
import { loadUrlIntoStore, getMapBytes } from 'mudlet-map-editor';
import { clearToken, startOAuth } from './auth';
import { getUser, getOpenPRs, getMasterSha, createBranch, getFileSha, uploadFile, createPR, updatePR, uint8ToBase64, getLatestRelease, getProxiedMapUrl, BRANCH, OpenPR } from './api';
import { acquireLock, releaseLock } from './lock';
import { subscribe, getToken, getSavedBytes, getHasLock, setLockInfo, clearLockInfo, setSavedBytes, getMapVersion, getLockExpiresAt, getLockDuration } from './state';

const HOUR = 1000 * 60 * 60;
const LOCK_OPTIONS = [
    { label: '1 hour',   duration: HOUR },
    { label: '2 hours',  duration: HOUR * 2 },
    { label: '4 hours',  duration: HOUR * 4 },
    { label: '8 hours',  duration: HOUR * 8 },
];

function formatRemaining(ms: number) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function LockGauge() {
    const [, tick] = useState(0);

    useEffect(() => {
        const id = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const expiresAt = getLockExpiresAt();
    const duration = getLockDuration();
    const remaining = expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;

    useEffect(() => {
        if (expiresAt && remaining === 0) clearLockInfo();
    }, [expiresAt, remaining]);

    if (!expiresAt || !duration || remaining === 0) return null;

    const pct = Math.min(100, (remaining / duration) * 100);
    const color = pct > 50 ? '#a6e3a1' : pct > 20 ? '#ffd080' : '#f38ba8';

    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: '#c0cfe6', marginBottom: 3 }}>
                <span>Lock remaining</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRemaining(remaining)}</span>
            </div>
            <div style={{
                background: 'rgba(6, 9, 16, 0.6)',
                border: '1px solid rgba(143, 184, 255, 0.15)',
                borderRadius: 4,
                height: 6,
                overflow: 'hidden',
            }}>
                <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    transition: 'width 1s linear, background 0.3s',
                }} />
            </div>
        </div>
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

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    const token = getToken();
    const mapVersion = getMapVersion();
    const hasLock = getHasLock();
    const savedBytes = getSavedBytes();
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
            if (res.result) setLockInfo(duration);
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
            clearLockInfo();
        } catch (e) {
            setStatus(String(e));
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
            clearLockInfo();
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

    if (!token) {
        return (
            <div className="panel-content">
                <h3>Arkadia Sync</h3>
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
                <button type="button" style={{ marginLeft: 'auto' }} onClick={() => { clearToken(); clearLockInfo(); }}>
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
                {mapVersion && latestRelease && !versionMatch && (
                    <p className="hint" style={{ color: '#f38ba8', marginTop: 4 }}>
                        Version mismatch — fetch the latest map before locking.
                    </p>
                )}
            </div>

            {existingPR ? (
                <div>
                    {isMyPR ? (
                        <>
                            <p className="hint" style={{ color: '#ffd080', marginBottom: 4 }}>
                                Your PR is open — locking is disabled.
                            </p>
                            <a href={existingPR.html_url} target="_blank" rel="noreferrer" className="hint"
                                style={{ display: 'block', marginBottom: 8, wordBreak: 'break-all' }}>
                                {existingPR.html_url}
                            </a>
                            <p className="hint" style={{ color: savedBytes ? '#a6e3a1' : undefined, marginBottom: 8 }}>
                                {savedBytes ? 'Map staged — ready to update.' : 'Stage the map to enable update.'}
                            </p>
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
                            {hasLock && (
                                <>
                                    <LockGauge />
                                    <button type="button" disabled={busy} onClick={handleRelease}>
                                        Release lock
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="hint" style={{ marginBottom: 4 }}>
                                An open PR from <strong>{existingPR.user.login}</strong> exists — locking is disabled.
                            </p>
                            <a href={existingPR.html_url} target="_blank" rel="noreferrer" className="hint"
                                style={{ display: 'block', wordBreak: 'break-all' }}>
                                {existingPR.html_url}
                            </a>
                        </>
                    )}
                </div>
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
                    <LockGauge />
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

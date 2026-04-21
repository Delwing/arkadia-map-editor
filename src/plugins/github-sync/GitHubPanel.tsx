import { useEffect, useState } from 'react';
import { loadUrlIntoStore, getMapBytes } from 'mudlet-map-editor';
import { clearToken, startOAuth } from './auth';
import { getUser, getOpenPRs, getMasterSha, createBranch, getFileSha, uploadFile, createPR, uint8ToBase64, getLatestRelease, getProxiedMapUrl } from './api';
import { acquireLock, releaseLock } from './lock';
import { subscribe, getToken, getSavedBytes, getHasLock, setHasLock, setSavedBytes, getMapVersion } from './state';

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
    const [prMessage, setPrMessage] = useState('');
    const [status, setStatus] = useState('');
    const [prUrl, setPrUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

    const token = getToken();
    const mapVersion = getMapVersion();
    const hasLock = getHasLock();
    const savedBytes = getSavedBytes();
    const versionMatch = mapVersion != null && latestRelease != null && mapVersion === latestRelease;

    useEffect(() => {
        if (!token) { setUser(null); return; }
        getUser(token).then(setUser).catch(() => clearToken());
    }, [token]);

    useEffect(() => {
        getLatestRelease().then(setLatestRelease);
    }, []);

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
            if (res.result) setHasLock(true);
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
                setStatus(`Open PR already exists: ${prs[0].html_url}`);
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
            setStatus('PR created.');
            setPrUrl(pr.html_url);

            await releaseLock(token);
            setHasLock(false);
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
            {user && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <img src={user.avatar_url} alt="" width={24} height={24} style={{ borderRadius: '50%' }} />
                    <span>{user.login}</span>
                    <button type="button" style={{ marginLeft: 'auto' }} onClick={() => { clearToken(); setHasLock(false); }}>
                        Logout
                    </button>
                </div>
            )}

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

            {!hasLock ? (
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
            {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="hint" style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                    {prUrl}
                </a>
            )}
        </div>
    );
}

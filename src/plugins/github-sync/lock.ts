const LOCK_API = import.meta.env.VITE_LOCK_API_URL as string;

function headers(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

export type LockStatus =
    | { locked: false }
    | { locked: true; user: string; expiresAt: number };

/**
 * Throws rather than reporting "no lock" when the backend is unreachable or
 * unhappy: the caller keeps the last known state on a failure, and an outage
 * must not look like a lock that has been released. The timeout is what keeps
 * a hung request from stalling the refresh that follows it.
 */
export async function getLockStatus(): Promise<LockStatus> {
    const res = await fetch(`${LOCK_API}/api/lock`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`lock status ${res.status}`);
    return res.json();
}

export async function acquireLock(token: string, duration: number): Promise<{ message: string; result: boolean }> {
    const res = await fetch(`${LOCK_API}/api/lock`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ lock: duration }),
    });
    return res.json();
}

export async function releaseLock(token: string): Promise<{ message: string }> {
    const res = await fetch(`${LOCK_API}/api/release`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({}),
    });
    return res.json();
}

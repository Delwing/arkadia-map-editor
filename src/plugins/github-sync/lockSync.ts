import { getUser } from './api';
import { getLockStatus } from './lock';
import { clearToken, getCurrentUser, getToken, setCurrentUser, setHasLock, setLockOwner } from './state';

/**
 * Keeps `hasLock` in step with the server.
 *
 * The lock lives in the backend, so holding one is not something a tab can
 * remember: a reload used to reset `hasLock` to false and offer to take a lock
 * the user was already holding. Ownership is therefore *derived* — the lock is
 * ours when its owner matches the logged-in login — and re-read on start, on
 * login, after every lock action, when it expires, and while the tab is open.
 */

/** How often a visible tab re-reads the lock, so someone else's lock and our
 *  own expiry both show up without a reload. */
const POLL_MS = 60_000;

/** A lock can never outlive the longest offered duration; anything beyond that
 *  is a clock disagreement, not a deadline worth arming a timer for. */
const MAX_LOCK_MS = 8 * 60 * 60 * 1000;

let poll: ReturnType<typeof setInterval> | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function readLock(): Promise<void> {
    const status = await getLockStatus().catch(() => null);
    // A network blip is not evidence that the lock is gone — keep what we have.
    if (!status) return;

    const owner = status.locked ? { user: status.user, expiresAt: status.expiresAt } : null;
    setLockOwner(owner);
    const me = getCurrentUser()?.login;
    setHasLock(owner != null && me != null && owner.user === me);

    // Ask again the moment it lapses; the poll alone would leave a dead lock on
    // screen for up to a minute.
    if (expiry) { clearTimeout(expiry); expiry = null; }
    if (owner) {
        const ms = owner.expiresAt - Date.now();
        if (ms > 0 && ms < MAX_LOCK_MS) {
            expiry = setTimeout(() => { expiry = null; void refreshLock(); }, ms + 1000);
        }
    }
}

// Reads are serialized rather than deduplicated: a refresh asked for *after* we
// took or released the lock has to see the state as of that action, which a
// request already in flight cannot. Chaining also keeps a slow earlier response
// from landing on top of a newer one.
let chain: Promise<void> = Promise.resolve();

/** Re-read the lock and work out whether it is ours. */
export function refreshLock(): Promise<void> {
    chain = chain.then(readLock, readLock);
    return chain;
}

let userInFlight: { token: string | null; done: Promise<void> } | null = null;

/** Re-read who we are, then re-derive the lock from it. */
export function refreshUser(): Promise<void> {
    const token = getToken();
    // Both app start and the panel's mount ask for this; one fetch serves both.
    // Keyed by token so a login mid-flight still gets its own read.
    if (userInFlight && userInFlight.token === token) return userInFlight.done;

    const done = (async () => {
        if (!token) {
            setCurrentUser(null);
        } else {
            try {
                setCurrentUser(await getUser(token));
            } catch {
                // A rejected token is a dead session: drop it rather than stay
                // logged in with no identity to match against the lock's owner.
                clearToken();
                setCurrentUser(null);
            }
        }
        await refreshLock();
    })().finally(() => {
        if (userInFlight?.done === done) userInFlight = null;
    });

    userInFlight = { token, done };
    return done;
}

function onVisible(): void {
    if (document.visibilityState === 'visible') void refreshLock();
}

/** Start the periodic refresh. Safe to call more than once. */
export function startLockSync(): void {
    if (started) { void refreshUser(); return; }
    started = true;

    void refreshUser();
    document.addEventListener('visibilitychange', onVisible);
    poll = setInterval(onVisible, POLL_MS);
}

/** Only used to keep hot reloads from stacking timers. */
export function stopLockSync(): void {
    if (poll) { clearInterval(poll); poll = null; }
    if (expiry) { clearTimeout(expiry); expiry = null; }
    document.removeEventListener('visibilitychange', onVisible);
    started = false;
}

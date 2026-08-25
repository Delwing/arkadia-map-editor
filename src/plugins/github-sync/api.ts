const REPO = import.meta.env.VITE_GITHUB_REPO as string;
const MAP_FILE = (import.meta.env.VITE_GITHUB_MAP_FILE as string) || 'map.dat';
export const BRANCH = (import.meta.env.VITE_GITHUB_BRANCH as string) || 'development';
const REPO_API = `https://api.github.com/repos/${REPO}`;

export interface OpenPR {
    number: number;
    html_url: string;
    title: string;
    user: { login: string; avatar_url: string };
    head: { sha: string };
}

export interface CheckRun {
    id: number;
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
    html_url: string;
}

export interface Review {
    id: number;
    user: { login: string; avatar_url: string };
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
    submitted_at: string;
}

function headers(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

export async function getUser(token: string): Promise<{ login: string; avatar_url: string }> {
    const res = await fetch('https://api.github.com/user', { headers: headers(token) });
    if (!res.ok) throw new Error('Failed to fetch user');
    return res.json();
}

export async function getOpenPRs(token: string): Promise<OpenPR[]> {
    const owner = REPO.split('/')[0];
    const res = await fetch(`${REPO_API}/pulls?state=open&head=${owner}:${BRANCH}&base=master`, { headers: headers(token) });
    if (!res.ok) return [];
    return res.json();
}

export async function getRequiredApprovals(token: string): Promise<number | null> {
    const res = await fetch(`${REPO_API}/branches/master`, {
        headers: { ...headers(token), Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.protection?.required_pull_request_reviews?.required_approving_review_count ?? null;
}

export async function getPRChecks(token: string, ref: string): Promise<CheckRun[]> {
    const res = await fetch(`${REPO_API}/commits/${ref}/check-runs?per_page=100`, {
        headers: { ...headers(token), Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.check_runs ?? [];
}

export async function getPRReviews(token: string, prNumber: number): Promise<Review[]> {
    const res = await fetch(`${REPO_API}/pulls/${prNumber}/reviews?per_page=100`, { headers: headers(token) });
    if (!res.ok) return [];
    return res.json();
}

export async function getMasterSha(token: string): Promise<string> {
    const res = await fetch(`${REPO_API}/git/refs/heads/master`, { headers: headers(token) });
    const data = await res.json();
    return data.object.sha;
}

export async function createBranch(token: string, sha: string): Promise<void> {
    const res = await fetch(`${REPO_API}/git/refs`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to create branch');
    }
}

export async function getFileSha(token: string, ref: string): Promise<string> {
    const res = await fetch(`${REPO_API}/contents/${MAP_FILE}?ref=${ref}`, { headers: headers(token) });
    const data = await res.json();
    return data.sha;
}

export async function uploadFile(token: string, base64Content: string, fileSha: string, message = 'update map'): Promise<void> {
    const res = await fetch(`${REPO_API}/contents/${MAP_FILE}`, {
        method: 'PUT',
        headers: headers(token),
        body: JSON.stringify({
            content: base64Content,
            message,
            branch: BRANCH,
            sha: fileSha,
        }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to upload file');
    }
}

export async function getLatestRelease(): Promise<string | null> {
    const res = await fetch(`${REPO_API}/releases/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.tag_name ?? null;
}

export function getProxiedMapUrl(): string {
    return `${import.meta.env.VITE_LOCK_API_URL}/api/map/latest`;
}

export function getProxiedBranchMapUrl(): string {
    return `${import.meta.env.VITE_LOCK_API_URL}/api/map/branch`;
}

export async function createPR(token: string, title: string, body: string): Promise<OpenPR> {
    const res = await fetch(`${REPO_API}/pulls`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ title, body, head: BRANCH, base: 'master' }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to create PR');
    }
    return res.json();
}

export async function updatePR(token: string, prNumber: number, title: string, body: string): Promise<void> {
    const res = await fetch(`${REPO_API}/pulls/${prNumber}`, {
        method: 'PATCH',
        headers: headers(token),
        body: JSON.stringify({ title, body }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to update PR');
    }
}

export function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

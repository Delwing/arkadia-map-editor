const REPO = import.meta.env.VITE_GITHUB_REPO as string;
const MAP_FILE = (import.meta.env.VITE_GITHUB_MAP_FILE as string) || 'map.dat';
const BRANCH = (import.meta.env.VITE_GITHUB_BRANCH as string) || 'development';
const REPO_API = `https://api.github.com/repos/${REPO}`;

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

export async function getOpenPRs(token: string): Promise<{ url: string; html_url: string }[]> {
    const res = await fetch(`${REPO_API}/pulls?state=open&base=master`, { headers: headers(token) });
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

export async function uploadFile(token: string, base64Content: string, fileSha: string): Promise<void> {
    const res = await fetch(`${REPO_API}/contents/${MAP_FILE}`, {
        method: 'PUT',
        headers: headers(token),
        body: JSON.stringify({
            content: base64Content,
            message: 'update map',
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

export async function createPR(token: string, title: string, body: string): Promise<{ html_url: string }> {
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

export function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

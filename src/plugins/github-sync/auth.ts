export { getToken, setToken, clearToken } from './state';

const LOCK_API = import.meta.env.VITE_LOCK_API_URL as string;
const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string;

export function startOAuth(): void {
    const redirectUri = (window.location.origin + window.location.pathname).replace(/\/$/, '');
    const url = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    window.open(url, 'github-oauth', 'width=600,height=700,popup=1');
}

export function isOAuthPopup(): boolean {
    return !!window.opener && new URLSearchParams(window.location.search).has('code');
}

export async function exchangeCode(code: string): Promise<string> {
    const res = await fetch(`${LOCK_API}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.token;
}

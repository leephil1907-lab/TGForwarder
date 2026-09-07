const STORAGE_KEY = 'tgforwarder_access_token';

export function getStoredToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token.trim());
  } catch {
    // localStorage unavailable (private mode, etc.) — token just won't persist
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Appends the stored access token as a `token` query param. Needed for the
 * SSE EventSource connection, which cannot send custom Authorization headers.
 */
export function withTokenParam(url: string): string {
  const token = getStoredToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Patches the global fetch so every same-origin request to /api/* automatically
 * carries the stored access token as a Bearer header. This lets every existing
 * `fetch('/api/...')` call throughout the app stay untouched while still being
 * authenticated. Safe to call once at app startup.
 */
export function installAuthenticatedFetch(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const isApiCall = url.startsWith('/api/');

    if (!isApiCall) {
      return originalFetch(input, init);
    }

    const token = getStoredToken();
    const headers = new Headers(init?.headers || (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).headers : undefined));
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return originalFetch(input, { ...init, headers });
  };
}

// ── QA Touchstone — cookie matching (RFC 6265 subset) ──────────────────────
// Pure helper. Decides whether a stored cookie should be sent with a given
// request URL. Kept in its own module so it can be unit-tested in isolation
// from the App component that calls it.

/** Stored-cookie fields the matcher inspects (callers may pass richer objects). */
export interface StoredCookie {
  on?: boolean;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  expires?: string;
}

export function cookieMatches(ck: StoredCookie | null | undefined, requestUrl: string): boolean {
  if (!ck || !ck.on || !requestUrl || !ck.domain) return false;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  // Domain match: host-only cookies (Set-Cookie with no Domain attribute)
  // must match the exact request host. Otherwise the cookie's scope domain
  // may match the same host or any subdomain — but never the parent.
  if (ck.hostOnly) {
    if (host !== ck.domain) return false;
  } else if (!(host === ck.domain || host.endsWith('.' + ck.domain))) {
    return false;
  }
  // Path match per RFC 6265: equal, or request path starts with the cookie
  // path AND the boundary char in the request path is a `/`.
  const path = parsed.pathname || '/';
  const ckPath = ck.path || '/';
  const pathMatch =
    path === ckPath ||
    (path.startsWith(ckPath) && (ckPath.endsWith('/') || path[ckPath.length] === '/'));
  if (!pathMatch) return false;
  // Secure: only send over https.
  if (ck.secure && parsed.protocol !== 'https:') return false;
  // Expires: drop expired cookies (best-effort; unparseable strings stay).
  if (ck.expires) {
    const exp = Date.parse(ck.expires);
    if (isFinite(exp) && exp < Date.now()) return false;
  }
  return true;
}

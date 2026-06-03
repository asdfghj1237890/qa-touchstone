// ── QA Touchstone — rate-limit / abuse testing engine (pure logic) ──────────
// Fires a bounded real burst at an endpoint and reports whether throttling
// engages. The ABSENCE of a throttle signal is the finding. UI in RateLimitPanel.
import './setup.js';

export const MAX_N = 200;
export const MAX_CONCURRENCY = 10;

// Lowercased header names that indicate a rate limiter is present.
export const THROTTLE_HEADERS = [
  'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
];

// Scan a burst's responses for a throttle signal: any 429, or any rate-limit
// header (compared case-insensitively). Presence of a RateLimit-* header means
// a limiter exists, so it counts as throttled even on a 2xx.
export function detectThrottleSignal(responses) {
  let saw429 = false, headerHit = false;
  for (const r of responses || []) {
    if (!r) continue;
    if (r.status === 429) saw429 = true;
    const hdrs = r.headers || {};
    for (const k of Object.keys(hdrs)) {
      if (THROTTLE_HEADERS.includes(k.toLowerCase())) { headerHit = true; break; }
    }
    if (saw429 && headerHit) break;
  }
  return { throttled: saw429 || headerHit, saw429, headerHit };
}

// completedCount = responses that returned a real HTTP status (net errors excluded).
export function classifyRateLimit(signal, completedCount) {
  if (signal && signal.throttled) return 'pass';
  if (completedCount > 0) return 'vuln';
  return 'inconclusive';
}

export function rateLimitSeverity(sensitivity, verdict) {
  if (verdict !== 'vuln') return null;
  return sensitivity === 'sensitive' ? 'high' : 'low';
}

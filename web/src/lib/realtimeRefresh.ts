export const TRANSPORT_REFRESH_COOLDOWN_MS = 5_000;
export const REALTIME_REFRESH_DELAY_MS = 300;
export const REALTIME_CAPACITY_RETRY_MS = 5 * 60_000;

/**
 * Decide whether and when the local SSE transport should reconnect.
 * Authentication failures require a new session, while capacity/rate limits
 * must respect the server's Retry-After response instead of hammering it.
 */
export function realtimeHttpRetryDelayMs(
  status: number,
  retryAfter: string | null,
  fallbackMs: number,
  now = Date.now()
): number | null {
  if (status === 401 || status === 403) return null;
  if (status !== 429 && status !== 503) return fallbackMs;

  const value = retryAfter?.trim();
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(1_000, Math.round(seconds * 1_000));
    }
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) {
      return Math.max(1_000, retryAt - now);
    }
  }

  return REALTIME_CAPACITY_RETRY_MS;
}

/** Collapse a burst of related invalidations into one active-query refresh. */
export function createRealtimeRefreshScheduler(
  refresh: () => void,
  delayMs = REALTIME_REFRESH_DELAY_MS
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export function shouldRefreshAfterTransportReady(
  lastRefreshAt: number,
  now: number,
  cooldownMs = TRANSPORT_REFRESH_COOLDOWN_MS
): boolean {
  return now - lastRefreshAt >= cooldownMs;
}

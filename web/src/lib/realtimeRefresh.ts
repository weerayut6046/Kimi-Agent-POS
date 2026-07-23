export const TRANSPORT_REFRESH_COOLDOWN_MS = 5_000;

export function shouldRefreshAfterTransportReady(
  lastRefreshAt: number,
  now: number,
  cooldownMs = TRANSPORT_REFRESH_COOLDOWN_MS
): boolean {
  return now - lastRefreshAt >= cooldownMs;
}

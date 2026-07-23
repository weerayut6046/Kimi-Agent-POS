const MAX_QUERY_RETRIES = 2;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const status = (data as { httpStatus?: unknown }).httpStatus;
  return typeof status === "number" && Number.isInteger(status)
    ? status
    : undefined;
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  const status = httpStatus(error);
  if (status === undefined) return true;
  return RETRYABLE_HTTP_STATUSES.has(status) || status >= 500;
}

export function calculateQueryRetryDelay(
  attemptIndex: number,
  random: () => number = Math.random
): number {
  const baseDelay = Math.min(750 * 2 ** Math.max(0, attemptIndex), 8_000);
  const jitter = Math.floor(baseDelay * 0.5 * random());
  return baseDelay + jitter;
}

export function queryRetryDelay(attemptIndex: number, _error: unknown): number {
  return calculateQueryRetryDelay(attemptIndex);
}

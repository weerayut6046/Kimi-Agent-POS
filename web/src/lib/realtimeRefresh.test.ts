import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRealtimeRefreshScheduler,
  REALTIME_CAPACITY_RETRY_MS,
  REALTIME_REFRESH_DELAY_MS,
  realtimeHttpRetryDelayMs,
  shouldRefreshAfterTransportReady,
  TRANSPORT_REFRESH_COOLDOWN_MS,
} from "./realtimeRefresh";

describe("realtime transport refresh", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes once for a mutation followed by its audit event", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRealtimeRefreshScheduler(refresh);
    scheduler.schedule();
    vi.advanceTimersByTime(100);
    scheduler.schedule();
    vi.advanceTimersByTime(REALTIME_REFRESH_DELAY_MS - 100);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    vi.advanceTimersByTime(REALTIME_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels a queued refresh when the connection changes", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRealtimeRefreshScheduler(refresh);
    scheduler.schedule();
    scheduler.cancel();
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("coalesces the SSE-ready and Supabase-subscribed handover", () => {
    const firstReadyAt = 10_000;
    expect(
      shouldRefreshAfterTransportReady(Number.NEGATIVE_INFINITY, firstReadyAt)
    ).toBe(true);
    expect(
      shouldRefreshAfterTransportReady(firstReadyAt, firstReadyAt + 500)
    ).toBe(false);
    expect(
      shouldRefreshAfterTransportReady(
        firstReadyAt,
        firstReadyAt + TRANSPORT_REFRESH_COOLDOWN_MS
      )
    ).toBe(true);
  });

  it("backs off for capacity responses using Retry-After", () => {
    expect(realtimeHttpRetryDelayMs(503, "300", 1_000)).toBe(300_000);
    expect(realtimeHttpRetryDelayMs(503, null, 1_000)).toBe(
      REALTIME_CAPACITY_RETRY_MS
    );
    expect(realtimeHttpRetryDelayMs(429, "2", 1_000)).toBe(2_000);
  });

  it("stops retrying when the local session is no longer authorized", () => {
    expect(realtimeHttpRetryDelayMs(401, null, 1_000)).toBeNull();
    expect(realtimeHttpRetryDelayMs(403, null, 1_000)).toBeNull();
    expect(realtimeHttpRetryDelayMs(500, null, 2_000)).toBe(2_000);
  });
});

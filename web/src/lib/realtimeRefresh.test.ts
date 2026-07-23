import { describe, expect, it } from "vitest";
import {
  shouldRefreshAfterTransportReady,
  TRANSPORT_REFRESH_COOLDOWN_MS,
} from "./realtimeRefresh";

describe("realtime transport refresh", () => {
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
});

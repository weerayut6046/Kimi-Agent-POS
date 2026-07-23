import { describe, expect, it } from "vitest";
import { calculateQueryRetryDelay, shouldRetryQuery } from "./queryRetry";

function trpcError(httpStatus: number) {
  return { data: { httpStatus } };
}

describe("query retry policy", () => {
  it("retries transient server and rate-limit responses at most twice", () => {
    expect(shouldRetryQuery(0, trpcError(503))).toBe(true);
    expect(shouldRetryQuery(1, trpcError(429))).toBe(true);
    expect(shouldRetryQuery(2, trpcError(503))).toBe(false);
  });

  it("does not retry deterministic client errors", () => {
    expect(shouldRetryQuery(0, trpcError(400))).toBe(false);
    expect(shouldRetryQuery(0, trpcError(401))).toBe(false);
    expect(shouldRetryQuery(0, trpcError(403))).toBe(false);
    expect(shouldRetryQuery(0, trpcError(404))).toBe(false);
  });

  it("adds bounded jitter so concurrent failures do not retry together", () => {
    expect(calculateQueryRetryDelay(0, () => 0)).toBe(750);
    expect(calculateQueryRetryDelay(0, () => 0.999)).toBeGreaterThan(750);
    expect(calculateQueryRetryDelay(0, () => 0.999)).toBeLessThan(1_125);
    expect(calculateQueryRetryDelay(10, () => 0)).toBe(8_000);
  });
});

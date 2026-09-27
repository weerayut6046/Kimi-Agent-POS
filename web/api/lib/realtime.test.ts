import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishRealtimeInvalidation,
  realtimeTestUtils,
  RealtimeCapacityError,
  subscribeRealtime,
} from "./realtime";

afterEach(() => {
  realtimeTestUtils?.reset();
  vi.useRealTimers();
});

describe("secure realtime invalidation bus", () => {
  it("publishes only an opaque invalidation event", () => {
    const received: unknown[] = [];
    const subscription = subscribeRealtime(3, 7, event =>
      received.push(event)
    );

    const event = publishRealtimeInvalidation(7);

    expect(received).toEqual([event]);
    expect(Object.keys(event).sort()).toEqual([
      "branchId",
      "eventId",
      "scope",
      "version",
    ]);
    expect(JSON.stringify(event)).not.toMatch(
      /customer|staff|sale|amount|total|name|phone/i
    );
    subscription.unsubscribe();
    expect(realtimeTestUtils?.subscriberCount()).toBe(0);
  });

  it("limits connections per staff account", () => {
    const subscriptions = Array.from({ length: 20 }, () =>
      subscribeRealtime(3, 7, () => undefined)
    );
    expect(() => subscribeRealtime(3, 7, () => undefined)).toThrow(
      RealtimeCapacityError
    );
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });

  it("prunes leaked connections after their lease expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const leaked = Array.from({ length: 20 }, () =>
      subscribeRealtime(3, 7, () => undefined)
    );

    vi.advanceTimersByTime(60_001);
    const replacement = subscribeRealtime(3, 7, () => undefined);

    expect(realtimeTestUtils?.subscriberCount()).toBe(1);
    replacement.unsubscribe();
    leaked.forEach(subscription => subscription.unsubscribe());
  });

  it("does not deliver invalidations across branches", () => {
    const branchSeven: unknown[] = [];
    const branchEight: unknown[] = [];
    const subscriptionSeven = subscribeRealtime(3, 7, event =>
      branchSeven.push(event)
    );
    const subscriptionEight = subscribeRealtime(4, 8, event =>
      branchEight.push(event)
    );

    const event = publishRealtimeInvalidation(7);

    expect(branchSeven).toEqual([event]);
    expect(branchEight).toEqual([]);
    subscriptionSeven.unsubscribe();
    subscriptionEight.unsubscribe();
  });
});

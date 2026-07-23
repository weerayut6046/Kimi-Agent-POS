import { afterEach, describe, expect, it } from "vitest";
import {
  publishRealtimeInvalidation,
  realtimeTestUtils,
  RealtimeCapacityError,
  subscribeRealtime,
} from "./realtime";

afterEach(() => realtimeTestUtils?.reset());

describe("secure realtime invalidation bus", () => {
  it("publishes only an opaque invalidation event", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeRealtime(3, 7, event => received.push(event));

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
    unsubscribe();
    expect(realtimeTestUtils?.subscriberCount()).toBe(0);
  });

  it("limits connections per staff account", () => {
    const subscriptions = Array.from({ length: 20 }, () =>
      subscribeRealtime(3, 7, () => undefined)
    );
    expect(() => subscribeRealtime(3, 7, () => undefined)).toThrow(
      RealtimeCapacityError
    );
    subscriptions.forEach(unsubscribe => unsubscribe());
  });

  it("does not deliver invalidations across branches", () => {
    const branchSeven: unknown[] = [];
    const branchEight: unknown[] = [];
    const unsubscribeSeven = subscribeRealtime(3, 7, event =>
      branchSeven.push(event)
    );
    const unsubscribeEight = subscribeRealtime(4, 8, event =>
      branchEight.push(event)
    );

    const event = publishRealtimeInvalidation(7);

    expect(branchSeven).toEqual([event]);
    expect(branchEight).toEqual([]);
    unsubscribeSeven();
    unsubscribeEight();
  });
});

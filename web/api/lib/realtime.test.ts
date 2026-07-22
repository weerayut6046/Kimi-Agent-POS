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
    const unsubscribe = subscribeRealtime(3, event => received.push(event));

    const event = publishRealtimeInvalidation();

    expect(received).toEqual([event]);
    expect(Object.keys(event).sort()).toEqual([
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
      subscribeRealtime(3, () => undefined)
    );
    expect(() => subscribeRealtime(3, () => undefined)).toThrow(
      RealtimeCapacityError
    );
    subscriptions.forEach(unsubscribe => unsubscribe());
  });
});

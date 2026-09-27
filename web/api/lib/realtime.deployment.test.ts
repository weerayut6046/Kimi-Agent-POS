import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(async () => undefined),
  postgres: vi.fn(),
  fetch: vi.fn(async () => Response.json({ ok: true })),
}));

vi.mock("../queries/connection", () => ({
  getPostgresClient: mocks.postgres,
}));
vi.mock("./env", () => ({
  env: {
    databaseUrl: "postgresql://test:test@localhost/test",
    supabaseUrl: "https://unit-test.supabase.co",
    supabaseSecretKey: "unit-test-server-key",
  },
}));

import {
  publishRealtimeInvalidation,
  realtimeTestUtils,
  subscribeRealtime,
} from "./realtime";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "business");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.postgres.mockReturnValue({ notify: mocks.notify });
});

afterEach(() => {
  realtimeTestUtils?.reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deployment boundary for realtime publication", () => {
  it("does not dispatch or initialize database/Supabase publication in the platform", () => {
    const listener = vi.fn();
    const subscription = subscribeRealtime(1, 1, listener);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");

    const event = publishRealtimeInvalidation(1);

    expect(event).toMatchObject({ scope: "branch", branchId: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("preserves business publication across the local bus, database and Supabase", () => {
    const listener = vi.fn();
    const subscription = subscribeRealtime(1, 7, listener);
    vi.stubEnv("NODE_ENV", "production");

    const event = publishRealtimeInvalidation(7);

    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
      "pos_app_invalidation_v1",
      JSON.stringify(event)
    );
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://unit-test.supabase.co/realtime/v1/api/broadcast/pos-invalidation-v1%3A7/events/invalidate?private=true",
      {
        method: "POST",
        headers: {
          apikey: "unit-test-server-key",
          "content-type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );
    subscription.unsubscribe();
  });

  it("fails closed before publication for invalid deployment configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "invalid-mode");

    expect(() => publishRealtimeInvalidation(1)).toThrow(
      "PUMPPOS_DEPLOYMENT_MODE"
    );
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

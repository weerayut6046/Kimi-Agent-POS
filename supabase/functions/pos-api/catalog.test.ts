import { describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createCatalogReader } from "./catalog.ts";

type FakeClient = ReturnType<typeof postgres>;

function clientReturning(value: unknown): FakeClient {
  const client = vi.fn(() => Promise.resolve(value)) as unknown as FakeClient;
  client.end = vi.fn(async () => undefined);
  return client;
}

function clientFailing(error: Error): FakeClient {
  const client = vi.fn(() => Promise.reject(error)) as unknown as FakeClient;
  client.end = vi.fn(async () => undefined);
  return client;
}

describe("Supabase catalog reader", () => {
  it("reconnects once after a transient database connection failure", async () => {
    const clients = [
      clientFailing(Object.assign(new Error("connection ended"), {
        code: "CONNECTION_ENDED",
      })),
      clientReturning([{ active: true, username: "admin", role: "admin" }]),
    ];
    const reader = createCatalogReader(
      "postgresql://reader@example.test/pos",
      () => clients.shift()!,
    );

    await expect(
      reader.isActiveStaff({ id: 7, username: "admin", role: "admin" }),
    ).resolves.toBe(true);
    expect(clients).toHaveLength(0);
  });
});

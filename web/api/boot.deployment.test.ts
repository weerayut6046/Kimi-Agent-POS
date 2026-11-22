import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "business" as "business" | "platform",
  backup: vi.fn(),
  payment: vi.fn(),
  session: vi.fn(),
  subscribe: vi.fn(),
  menu: vi.fn(),
  systemAccess: vi.fn(),
}));

vi.mock("./lib/deployment", () => ({
  getDeploymentMode: () => mocks.mode,
}));
vi.mock("./lib/env", () => ({
  env: { isProduction: false, backupCronSecret: "unit-test-scheduler-secret" },
}));
vi.mock("./router", () => ({ appRouter: {} }));
vi.mock("./lib/authorization", () => ({
  activeStaffSessionFromRequest: mocks.session,
}));
vi.mock("./middleware", () => ({
  canUseProcedureMenu: mocks.menu,
}));
vi.mock("./lib/systemAccess", () => ({
  systemAccessForRequest: mocks.systemAccess,
}));
vi.mock("./lib/realtime", () => ({
  RealtimeCapacityError: class extends Error {},
  subscribeRealtime: mocks.subscribe,
}));
vi.mock("./lib/databaseBackup", () => ({
  BackupInProgressError: class extends Error {},
  createDatabaseBackup: mocks.backup,
}));
vi.mock("./payments/incomingPaymentHttp", () => ({
  handleIncomingPaymentRequest: mocks.payment,
}));

import app from "./boot";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "business";
  mocks.session.mockResolvedValue(null);
  mocks.menu.mockResolvedValue(false);
  mocks.systemAccess.mockResolvedValue({ allowed: false });
  mocks.backup.mockResolvedValue({
    objectName: "business-backup.sql.gz",
    sizeBytes: 100,
    createdAt: new Date("2026-09-27T00:00:00Z"),
    sha256: "unit-test-sha256",
  });
  mocks.payment.mockImplementation(async () =>
    Response.json({ ok: true, matched: false })
  );
});

describe("deployment boundary for HTTP endpoints", () => {
  it.each([
    ["POST", "/api/internal/database-backup"],
    ["GET", "/api/realtime"],
    ["POST", "/api/payments/incoming"],
    ["GET", "/api/lan-info"],
  ])(
    "blocks %s %s in a platform deployment before service access",
    async (method, url) => {
      mocks.mode = "platform";
      const response = await app.request(url, {
        method,
        headers: { authorization: "Bearer unit-test-scheduler-secret" },
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: "This endpoint requires a business deployment",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.backup).not.toHaveBeenCalled();
      expect(mocks.payment).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks.subscribe).not.toHaveBeenCalled();
    }
  );

  it("preserves the scheduler credential check for business backups", async () => {
    const unauthorized = await app.request("/api/internal/database-backup", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    expect(mocks.backup).not.toHaveBeenCalled();

    const authorized = await app.request("/api/internal/database-backup", {
      method: "POST",
      headers: { authorization: "Bearer unit-test-scheduler-secret" },
    });
    expect(authorized.status).toBe(200);
    expect(mocks.backup).toHaveBeenCalledExactlyOnceWith("scheduled");
  });

  it("preserves staff authentication for business realtime", async () => {
    const response = await app.request("/api/realtime");
    expect(response.status).toBe(401);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("stops a realtime stream when the staff's branch lease ends", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    try {
      const session = { id: 4, branchId: 1, exp: Date.now() / 1000 + 60 };
      mocks.session.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, branchId: 2 });
      mocks.subscribe.mockReturnValue({ touch: vi.fn(), unsubscribe });
      const response = await app.request("/api/realtime", {
        headers: { authorization: "Bearer realtime-session" },
      });
      const reader = response.body!.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain("event: ready");

      await vi.advanceTimersByTimeAsync(15_000);

      expect((await reader.read()).done).toBe(true);
      expect(unsubscribe).toHaveBeenCalledOnce();
      const [first, next] = mocks.session.mock.calls;
      expect(next[0]).not.toBe(first[0]);
      expect(next[0].headers.get("authorization")).toBe("Bearer realtime-session");
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires an active staff session, stock menu and system access for LAN discovery", async () => {
    expect((await app.request("/api/lan-info")).status).toBe(401);
    expect(mocks.menu).not.toHaveBeenCalled();

    const staff = { id: 4, branchId: 1 };
    mocks.session.mockResolvedValue(staff);
    expect((await app.request("/api/lan-info")).status).toBe(403);
    expect(mocks.menu).toHaveBeenCalledWith(staff, "stockCount.listSessions", expect.any(Request));
    expect(mocks.systemAccess).not.toHaveBeenCalled();

    mocks.menu.mockResolvedValue(true);
    expect((await app.request("/api/lan-info")).status).toBe(403);
    mocks.systemAccess.mockResolvedValue({ allowed: true });
    const response = await app.request("/api/lan-info");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("dispatches business payment hooks and reads the deployment on each request", async () => {
    const first = await app.request("/api/payments/incoming", {
      method: "POST",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, matched: false });
    expect(mocks.payment).toHaveBeenCalledOnce();

    mocks.mode = "platform";
    const second = await app.request("/api/payments/incoming", {
      method: "POST",
    });
    expect(second.status).toBe(403);
    expect(mocks.payment).toHaveBeenCalledOnce();
  });
});

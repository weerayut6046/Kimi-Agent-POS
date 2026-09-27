import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "business" as "business" | "platform",
  backup: vi.fn(),
  payment: vi.fn(),
  session: vi.fn(),
  subscribe: vi.fn(),
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

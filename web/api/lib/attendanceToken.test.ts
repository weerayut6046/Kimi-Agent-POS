import { beforeAll, describe, expect, it } from "vitest";

describe("attendance QR token", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.APP_SECRET = "attendance-test-secret-at-least-32-bytes";
  });

  it("issues, verifies, and scopes the idempotency key by staff", async () => {
    const {
      attendanceQrIdempotencyKey,
      issueAttendanceQrToken,
      verifyAttendanceQrToken,
    } = await import("./attendanceToken");
    const now = new Date("2026-09-21T03:00:00.000Z");
    const issued = issueAttendanceQrToken(4, now);
    const claims = verifyAttendanceQrToken(issued.token, now);

    expect(claims).toMatchObject({ branchId: 4, version: 1 });
    expect(issued.expiresAt.toISOString()).toBe("2026-09-21T03:00:45.000Z");
    expect(attendanceQrIdempotencyKey(claims, 8)).not.toBe(
      attendanceQrIdempotencyKey(claims, 9)
    );
  });

  it("rejects expired and modified tokens", async () => {
    const { issueAttendanceQrToken, verifyAttendanceQrToken } =
      await import("./attendanceToken");
    const now = new Date("2026-09-21T03:00:00.000Z");
    const issued = issueAttendanceQrToken(1, now);

    expect(() =>
      verifyAttendanceQrToken(
        issued.token,
        new Date("2026-09-21T03:00:46.000Z")
      )
    ).toThrow("หมดอายุ");
    expect(() => verifyAttendanceQrToken(`${issued.token}x`, now)).toThrow(
      "ไม่ถูกต้อง"
    );
  });

  it("issues and verifies tokens without a global Buffer", async () => {
    const { issueAttendanceQrToken, verifyAttendanceQrToken } =
      await import("./attendanceToken");
    const bufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "Buffer"
    );
    expect(bufferDescriptor).toBeDefined();

    Object.defineProperty(globalThis, "Buffer", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      const now = new Date("2026-09-21T03:00:00.000Z");
      const issued = issueAttendanceQrToken(4, now);
      expect(verifyAttendanceQrToken(issued.token, now)).toMatchObject({
        branchId: 4,
        version: 1,
      });
    } finally {
      Object.defineProperty(globalThis, "Buffer", bufferDescriptor!);
    }
  });
});

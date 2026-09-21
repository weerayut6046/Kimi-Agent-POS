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
    expect(issued.expiresAt.toISOString()).toBe("2026-09-21T03:01:30.000Z");
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
        new Date("2026-09-21T03:01:31.000Z")
      )
    ).toThrow("หมดอายุ");
    expect(() => verifyAttendanceQrToken(`${issued.token}x`, now)).toThrow(
      "ไม่ถูกต้อง"
    );
  });

  it("binds a face challenge to the QR, employee, action, and expiry", async () => {
    const {
      attendanceFaceIdempotencyKey,
      issueAttendanceFaceToken,
      issueAttendanceQrToken,
      verifyAttendanceFaceToken,
      verifyAttendanceQrToken,
    } = await import("./attendanceToken");
    const now = new Date("2026-09-21T03:00:00.000Z");
    const qr = verifyAttendanceQrToken(
      issueAttendanceQrToken(4, now).token,
      now
    );
    const issued = issueAttendanceFaceToken(
      { qrClaims: qr, staffId: 8, attendanceAction: "clock_in" },
      now
    );
    const claims = verifyAttendanceFaceToken(issued.token, now);

    expect(claims).toMatchObject({
      branchId: 4,
      staffId: 8,
      attendanceAction: "clock_in",
      qrNonce: qr.nonce,
    });
    expect(["blink", "turn_left", "turn_right"]).toContain(
      claims.livenessAction
    );
    expect(issued.expiresAt.toISOString()).toBe("2026-09-21T03:03:00.000Z");
    expect(attendanceFaceIdempotencyKey(claims)).toMatch(/^face:/);
    expect(() =>
      verifyAttendanceFaceToken(
        issued.token,
        new Date("2026-09-21T03:03:01.000Z")
      )
    ).toThrow("หมดอายุ");
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

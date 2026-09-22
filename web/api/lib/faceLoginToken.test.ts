import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.APP_SECRET = "test-".repeat(8);
});

describe("face login token", () => {
  it("issues a signed short-lived challenge scoped to staff and branch", async () => {
    const { issueLoginFaceToken, verifyLoginFaceToken } =
      await import("./faceLoginToken");
    const now = new Date("2026-09-21T03:00:00.000Z");
    const issued = issueLoginFaceToken({ branchId: 1, staffId: 8 }, now);
    expect(verifyLoginFaceToken(issued.token, now)).toMatchObject({
      branchId: 1,
      staffId: 8,
    });
    expect(issued.token).toMatch(/^PUMPLOGINFACE1\./);
    expect(() => verifyLoginFaceToken(`${issued.token}x`, now)).toThrow();
    expect(() =>
      verifyLoginFaceToken(issued.token, new Date("2026-09-21T03:03:01.000Z"))
    ).toThrow();
  });
});

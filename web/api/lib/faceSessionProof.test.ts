import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.APP_SECRET = "test-".repeat(8);
});

describe("face-verified Supabase session proof", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";

  it("binds proof to both user and Supabase session, with an expiry", async () => {
    const { issueFaceSessionProof, verifyFaceSessionProof } =
      await import("./faceSessionProof");
    const proof = issueFaceSessionProof(userId, sessionId, 1_000);
    expect(verifyFaceSessionProof(proof, userId, sessionId, 1_001)).toBe(true);
    expect(verifyFaceSessionProof(proof, userId,
      "33333333-3333-4333-8333-333333333333", 1_001)).toBe(false);
    expect(verifyFaceSessionProof(proof,
      "33333333-3333-4333-8333-333333333333", sessionId, 1_001)).toBe(false);
    expect(verifyFaceSessionProof(`${proof}x`, userId, sessionId, 1_001)).toBe(false);
    expect(verifyFaceSessionProof(proof, userId, sessionId,
      1_000 + 12 * 60 * 60)).toBe(false);
    expect(verifyFaceSessionProof(null, userId, sessionId, 1_001)).toBe(false);
  });

  it("does not depend on a global Buffer in the Edge runtime", async () => {
    const { issueFaceSessionProof, verifyFaceSessionProof } =
      await import("./faceSessionProof");
    vi.stubGlobal("Buffer", undefined);
    let valid: boolean;
    try {
      const proof = issueFaceSessionProof(userId, sessionId, 1_000);
      valid = verifyFaceSessionProof(proof, userId, sessionId, 1_001);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(valid).toBe(true);
  });
});

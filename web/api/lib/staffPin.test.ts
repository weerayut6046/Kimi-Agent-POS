import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashStaffPin,
  isLegacyStaffPinHash,
  verifyLegacyStaffPin,
  verifyStaffPin,
} from "./staffPin";

describe("staff PIN storage", () => {
  it("stores a keyed digest and verifies only the matching PIN", async () => {
    const stored = hashStaffPin("2048");
    expect(stored).toMatch(/^staff-pin-hmac-v1:/);
    expect(stored).not.toContain("2048");
    await expect(verifyStaffPin("2048", stored)).resolves.toBe(true);
    await expect(verifyStaffPin("2049", stored)).resolves.toBe(false);
  });

  it("accepts only 4-6 numeric digits", () => {
    expect(() => hashStaffPin("123")).toThrow("4-6");
    expect(() => hashStaffPin("1234567")).toThrow("4-6");
    expect(() => hashStaffPin("12a4")).toThrow("4-6");
  });

  it("recognizes and verifies only the historical SHA-256 PIN format", () => {
    const stored = createHash("sha256").update("1357").digest("hex");
    expect(isLegacyStaffPinHash(stored)).toBe(true);
    expect(isLegacyStaffPinHash(hashStaffPin("1357"))).toBe(false);
    expect(verifyLegacyStaffPin("1357", stored)).toBe(true);
    expect(verifyLegacyStaffPin("1358", stored)).toBe(false);
  });

  it("verifies a legacy PIN when the Edge runtime has no global Buffer", () => {
    const stored = createHash("sha256").update("1357").digest("hex");
    vi.stubGlobal("Buffer", undefined);
    let matched: boolean;
    try {
      matched = verifyLegacyStaffPin("1357", stored);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(matched).toBe(true);
  });
});

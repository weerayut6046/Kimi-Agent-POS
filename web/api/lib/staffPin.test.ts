import { describe, expect, it } from "vitest";
import { hashStaffPin, verifyStaffPin } from "./staffPin";

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
});

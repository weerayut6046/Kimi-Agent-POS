import { describe, expect, it } from "vitest";
import { hashLocalPassword, verifyLocalPassword } from "./localPassword";

describe("local development password storage", () => {
  it("stores a salted scrypt hash and verifies only the correct password", async () => {
    const first = await hashLocalPassword("DevOnly1234!");
    const second = await hashLocalPassword("DevOnly1234!");

    expect(first).toMatch(/^local-scrypt-v1:/);
    expect(first).not.toBe(second);
    await expect(verifyLocalPassword("DevOnly1234!", first)).resolves.toBe(
      true
    );
    await expect(verifyLocalPassword("wrong-password", first)).resolves.toBe(
      false
    );
  });

  it("rejects malformed stored values", async () => {
    await expect(verifyLocalPassword("anything", "broken")).resolves.toBe(
      false
    );
  });
});

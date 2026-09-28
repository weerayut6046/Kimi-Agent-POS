import { describe, expect, it } from "vitest";
import { createInitialOwnerInput } from "./initialSetup";

const owner = {
  requestId: "9c63ac72-68c4-4e34-954a-67dc8bc0ea69",
  name: " เจ้าของร้าน ",
  username: " OWNER ",
  pin: "5826",
};

describe("first-owner input boundary", () => {
  it("normalizes identity while preserving the exact private installation code", () => {
    const input = createInitialOwnerInput.parse({
      ...owner,
      installationCode: "private code ",
    });
    expect(input.name).toBe("เจ้าของร้าน");
    expect(input.username).toBe("owner");
    expect(input.installationCode).toBe("private code ");
  });

  it.each(["role", "menuPermissions", "branchId", "supabaseAuthUserId"])(
    "rejects caller-supplied privileged field %s",
    field => {
      expect(
        createInitialOwnerInput.safeParse({ ...owner, [field]: "admin" })
          .success
      ).toBe(false);
    }
  );

  it.each(["123", "1234567", "abc123", "1234 "])(
    "rejects invalid PIN %s",
    pin => {
      expect(createInitialOwnerInput.safeParse({ ...owner, pin }).success).toBe(
        false
      );
    }
  );

  it("requires explicit consent for face samples and rejects invalid numeric samples", () => {
    const embeddings = Array.from({ length: 3 }, () => Array(128).fill(0.2));
    expect(
      createInitialOwnerInput.safeParse({ ...owner, embeddings }).success
    ).toBe(false);
    expect(
      createInitialOwnerInput.safeParse({
        ...owner,
        embeddings,
        consentConfirmed: true,
      }).success
    ).toBe(true);
    embeddings[0][0] = Infinity;
    expect(
      createInitialOwnerInput.safeParse({
        ...owner,
        embeddings,
        consentConfirmed: true,
      }).success
    ).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";

function embedding(offset = 0): number[] {
  return Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.17 + offset) * 0.12
  );
}

describe("face biometrics", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.APP_SECRET = "face-biometric-test-secret-at-least-32-bytes";
  });

  it("encrypts templates with staff-bound authenticated encryption", async () => {
    const { decryptFaceEmbeddings, encryptFaceEmbeddings } =
      await import("./faceBiometrics");
    const source = [embedding(), embedding(0.01), embedding(-0.01)];
    const encrypted = await encryptFaceEmbeddings(3, source);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(JSON.stringify(source));
    await expect(decryptFaceEmbeddings(3, encrypted)).resolves.toHaveLength(3);
    await expect(decryptFaceEmbeddings(4, encrypted)).rejects.toThrow(
      "อ่านข้อมูลใบหน้า"
    );
  });

  it("matches identical embeddings and rejects incompatible dimensions", async () => {
    const { bestFaceSimilarity, faceSimilarity } =
      await import("./faceBiometrics");
    expect(faceSimilarity(embedding(), embedding())).toBe(1);
    expect(faceSimilarity(embedding(), embedding().slice(0, 64))).toBe(0);
    expect(
      bestFaceSimilarity(embedding(0.01), [embedding(), embedding(0.01)])
    ).toBe(1);
  });
});

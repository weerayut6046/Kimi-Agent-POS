import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;
beforeAll(async () => {
  test = await setupTestDb();
});
afterAll(() => test.cleanup());

const productInput = {
  code: "SETUP-NEW",
  name: "สินค้าจริง",
  category: "other" as const,
  unit: "ชิ้น",
  price: 20,
  cost: 10,
  stockQty: 4,
};

describe("catalog branch snapshot during owner setup", () => {
  it("rejects stale branch selection before creating or updating any product", async () => {
    const before = await test.db.query.products.findMany();
    await expect(
      test
        .caller("admin")
        .catalog.createProduct({ ...productInput, expectedBranchId: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      test.caller("admin").catalog.updateProduct({
        id: before[0].id,
        price: 999,
        expectedBranchId: 2,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await test.db.query.products.findMany()).toEqual(before);
  });
  it("accepts the matching snapshot and strips metadata from the database write", async () => {
    await test
      .caller("admin")
      .catalog.createProduct({ ...productInput, expectedBranchId: 1 });
    const created = await test.db.query.products.findFirst({
      where: eq(products.code, productInput.code),
    });
    expect(created).toMatchObject({ branchId: 1, price: 20 });
    await test.caller("admin").catalog.updateProduct({
      id: created!.id,
      price: 21,
      expectedBranchId: 1,
    });
    expect(
      await test.db.query.products.findFirst({
        where: eq(products.id, created!.id),
      })
    ).toMatchObject({ price: 21 });
  });
  it("retains existing clients and their administrator-only write ceiling", async () => {
    await expect(
      test
        .caller("admin")
        .catalog.createProduct({ ...productInput, code: "LEGACY-CLIENT" })
    ).resolves.toEqual({ ok: true });
    for (const role of ["cashier", "manager"] as const) {
      await expect(
        test
          .caller(role)
          .catalog.createProduct({ ...productInput, expectedBranchId: 1 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

describe("การจัดลำดับสินค้า", () => {
  it("อนุญาตให้ admin บันทึกลำดับใหม่และคืนสินค้าตามลำดับนั้น", async () => {
    const original = await test.caller("admin").catalog.listProducts();
    const reversedIds = original.map(product => product.id).reverse();

    await expect(
      test
        .caller("cashier")
        .catalog.reorderProducts({ productIds: reversedIds })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    await test
      .caller("admin")
      .catalog.reorderProducts({ productIds: reversedIds });

    const reordered = await test.caller("admin").catalog.listProducts();
    expect(reordered.map(product => product.id)).toEqual(reversedIds);
  });

  it("ปฏิเสธลำดับที่มีสินค้าซ้ำหรือไม่ครบ", async () => {
    const products = await test.caller("admin").catalog.listProducts();
    const productIds = products.map(product => product.id);

    await expect(
      test.caller("admin").catalog.reorderProducts({
        productIds: [productIds[0]!, productIds[0]!],
      })
    ).rejects.toThrow("รายการซ้ำ");

    await expect(
      test.caller("admin").catalog.reorderProducts({
        productIds: productIds.slice(1),
      })
    ).rejects.toThrow("รายการสินค้ามีการเปลี่ยนแปลง");
  });

  it("เก็บลำดับแยกตามสาขาและไม่คัดลอก id สินค้าเดิมไปสาขาใหม่", async () => {
    const main = test.caller("admin");
    const mainIds = (await main.catalog.listProducts()).map(
      product => product.id
    );
    const created = await main.auth.createBranch({
      code: "ORDER2",
      name: "สาขาทดสอบลำดับสินค้า",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    const second = test.caller("admin", 1, created.branch.id);
    const secondProducts = await second.catalog.listProducts();
    const secondIds = secondProducts.map(product => product.id);

    expect((await second.catalog.getSettings()).product_display_order).toBe("");

    const rotatedIds = [...secondIds.slice(1), secondIds[0]!];
    await second.catalog.reorderProducts({ productIds: rotatedIds });

    expect(
      (await second.catalog.listProducts()).map(product => product.id)
    ).toEqual(rotatedIds);
    expect(
      (await main.catalog.listProducts()).map(product => product.id)
    ).toEqual(mainIds);
  });
});

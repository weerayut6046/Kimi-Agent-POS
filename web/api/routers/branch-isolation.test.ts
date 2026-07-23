import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

describe("branch isolation", () => {
  it("keeps catalog values and settings independent between branches", async () => {
    const main = test.caller("admin");
    const created = await main.auth.createBranch({
      code: "TEST2",
      name: "สาขาทดสอบ 2",
      address: "อีกจังหวัด",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    const second = test.caller("admin", 1, created.branch.id);

    const [mainProductsBefore, secondProductsBefore] = await Promise.all([
      main.catalog.listProducts(),
      second.catalog.listProducts(),
    ]);
    const mainProduct = mainProductsBefore.find(product => product.code === "GSH95");
    const secondProduct = secondProductsBefore.find(
      product => product.code === "GSH95"
    );
    expect(mainProduct).toBeTruthy();
    expect(secondProduct).toBeTruthy();
    expect(secondProduct?.id).not.toBe(mainProduct?.id);

    await second.catalog.updateProduct({
      id: secondProduct!.id,
      price: 99.5,
    });
    await second.catalog.updateSettings({
      entries: [{ key: "shop_name", value: "สถานีสาขาสอง" }],
    });

    const [mainProductsAfter, secondProductsAfter, mainSettings, secondSettings] =
      await Promise.all([
        main.catalog.listProducts(),
        second.catalog.listProducts(),
        main.catalog.getSettings(),
        second.catalog.getSettings(),
      ]);

    expect(
      mainProductsAfter.find(product => product.code === "GSH95")?.price
    ).toBe(mainProduct?.price);
    expect(
      secondProductsAfter.find(product => product.code === "GSH95")?.price
    ).toBe(99.5);
    expect(secondSettings.shop_name).toBe("สถานีสาขาสอง");
    expect(mainSettings.shop_name).not.toBe("สถานีสาขาสอง");

    await expect(
      main.catalog.updateProduct({ id: secondProduct!.id, price: 1 })
    ).rejects.toThrow();
  });
});

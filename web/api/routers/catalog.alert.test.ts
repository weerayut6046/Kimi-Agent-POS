import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทส endpoint แจ้งเตือนสต็อกต่ำ/ถังใกล้หมด (กระดิ่งใน Layout โพล endpoint นี้)
// seed: ถังดีเซล B7 ต่ำกว่าเกณฑ์อยู่แล้ว (3100 ≤ 4000), สินค้าทุกตัวยังเหนือเกณฑ์
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

describe("แจ้งเตือนสต็อกต่ำ/ถังใกล้หมด", () => {
  it("คืนถังที่ต่ำกว่าเกณฑ์จาก seed และยังไม่มีสินค้าต่ำ", async () => {
    const res = await t.caller().catalog.lowStockAlerts();
    expect(res.lowTanks.map((x) => x.name)).toEqual(["ถังดีเซล B7"]);
    expect(res.lowProducts).toHaveLength(0);
    expect(res.count).toBe(res.lowTanks.length + res.lowProducts.length);
  });

  it("สินค้าที่ปรับสต็อกต่ำกว่าเกณฑ์เข้ารายการ และหลุดเมื่อเติมกลับ", async () => {
    const water = (await t.db.query.products.findMany()).find((p) => p.code === "WATER")!;

    await t.caller("admin").catalog.adjustStock({ productId: water.id, qty: 10, mode: "set" });
    let res = await t.caller().catalog.lowStockAlerts();
    const found = res.lowProducts.find((p) => p.id === water.id);
    expect(found).toMatchObject({ stockQty: 10, lowStockAt: 24, unit: "ขวด" });

    await t.caller("admin").catalog.adjustStock({ productId: water.id, qty: 120, mode: "set" });
    res = await t.caller().catalog.lowStockAlerts();
    expect(res.lowProducts.map((p) => p.id)).not.toContain(water.id);
  });

  it("ไม่แจ้งเตือนสินค้าหมวดน้ำมัน (แจ้งเฉพาะผ่านถัง) และสินค้าที่ปิดใช้งาน", async () => {
    const prods = await t.db.query.products.findMany();
    const fuel = prods.find((p) => p.code === "GSH95")!;
    const tissue = prods.find((p) => p.code === "TISSUE")!;

    // น้ำมัน stockQty ต่ำกว่าเกณฑ์ก็ไม่เข้ารายการสินค้า — ระดับน้ำมันเฝ้าผ่านถังเท่านั้น
    await t.caller("admin").catalog.updateProduct({ id: fuel.id, stockQty: 0, lowStockAt: 100 });
    // สินค้าที่ปิดใช้งาน (active=false) ไม่แจ้งเตือน
    await t.caller("admin").catalog.updateProduct({ id: tissue.id, stockQty: 0, active: false });

    const res = await t.caller().catalog.lowStockAlerts();
    expect(res.lowProducts.map((p) => p.id)).not.toContain(fuel.id);
    expect(res.lowProducts.map((p) => p.id)).not.toContain(tissue.id);
  });

  it("ถังที่ปรับระดับจนเกินเกณฑ์หลุดจากรายการ", async () => {
    const tank = (await t.db.query.fuelTanks.findMany()).find((x) => x.name === "ถังดีเซล B7")!;
    await t.caller("admin").catalog.updateTank({ id: tank.id, currentLiters: 5000 });
    const res = await t.caller().catalog.lowStockAlerts();
    expect(res.lowTanks.map((x) => x.id)).not.toContain(tank.id);
    expect(res.count).toBe(0);
  });
});

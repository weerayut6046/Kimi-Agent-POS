import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("pos dashboard", () => {
  it("รวมยอด กราฟ น้ำมัน และถังในคำขอเดียว", async () => {
    const fuel = await t.db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    if (!fuel) throw new Error("ไม่พบ GSH95 ใน seed");

    const { sale } = await t.caller().pos.createSale({
      items: [{ productId: fuel.id, qty: 5 }],
      paymentMethod: "cash",
    });

    const dashboard = await t.caller().pos.dashboard();

    expect(dashboard.chart).toHaveLength(7);
    expect(dashboard.todayBills).toBe(1);
    expect(dashboard.todayTotal).toBe(sale.total);
    expect(dashboard.litersToday).toBe(5);
    expect(dashboard.fuelByCode.GSH95?.liters).toBe(5);
    expect(dashboard.tanks.length).toBeGreaterThan(0);
    expect(dashboard.tanks[0]).toEqual(
      expect.objectContaining({
        percent: expect.any(Number),
        isLow: expect.any(Boolean),
      })
    );
    expect(dashboard.recentSales.some(row => row.id === sale.id)).toBe(true);
  });
});

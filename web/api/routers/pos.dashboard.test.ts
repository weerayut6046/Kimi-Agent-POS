import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nozzles, products, shiftReadings, shifts } from "@db/schema";
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
    const closedAt = new Date();
    const [closedShift] = await t.db
      .insert(shifts)
      .values({
        branchId: 1,
        staffName: "กะทดสอบ Dashboard",
        openedAt: new Date(closedAt.getTime() - 8 * 60 * 60 * 1000),
        closedAt,
        status: "closed",
        totalLiters: 100,
        totalAmount: 4900,
        totalMoneyMeter: 5000,
        posAmount: sale.total,
        openingFloat: 0,
      })
      .returning({ id: shifts.id });
    const nozzle = await t.db.query.nozzles.findFirst({
      where: eq(nozzles.productId, fuel.id),
    });
    if (!closedShift || !nozzle) throw new Error("เตรียมข้อมูลกะไม่สำเร็จ");
    await t.db.insert(shiftReadings).values({
      branchId: 1,
      shiftId: closedShift.id,
      nozzleId: nozzle.id,
      openMeter: 1000,
      closeMeter: 1100,
      openMoney: 10000,
      closeMoney: 15000,
      pricePerLiter: 49,
    });

    const dashboard = await t.caller().pos.dashboard();

    expect(dashboard.chart).toHaveLength(7);
    expect(dashboard.todayBills).toBe(1);
    expect(dashboard.todayPosTotal).toBe(sale.total);
    expect(dashboard.todayShiftTotal).toBe(5000);
    expect(dashboard.todayTotal).toBe(5000 + sale.total);
    expect(dashboard.todayShiftCount).toBe(1);
    expect(dashboard.shiftLitersToday).toBe(100);
    expect(dashboard.litersToday).toBe(100);
    expect(dashboard.fuelSource).toBe("shift");
    expect(dashboard.chart.at(-1)).toMatchObject({
      total: 5000 + sale.total,
      posTotal: sale.total,
      shiftTotal: 5000,
      shifts: 1,
    });
    expect(dashboard.fuelByCode.GSH95).toMatchObject({
      liters: 100,
      amount: 5000,
    });
    expect(dashboard.tanks.length).toBeGreaterThan(0);
    expect(dashboard.tanks[0]).toEqual(
      expect.objectContaining({
        percent: expect.any(Number),
        isLow: expect.any(Boolean),
      })
    );
    expect(dashboard.recentSales.some(row => row.id === sale.id)).toBe(true);
  });

  it("แสดงยอดน้ำมันจาก P เมื่อมิเตอร์เงินตั้งต้นเป็น 0", async () => {
    const before = await t.caller().pos.dashboard();
    const fuel = await t.db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    const nozzle = await t.db.query.nozzles.findFirst({
      where: eq(nozzles.productId, fuel!.id),
    });
    const closedAt = new Date();
    const [{ id }] = await t.db
      .insert(shifts)
      .values({
        staffName: "กะแรก P เริ่มจากศูนย์",
        openedAt: new Date(closedAt.getTime() - 60_000),
        closedAt,
        status: "closed",
        totalLiters: 12.5,
        totalAmount: 509.25,
        totalMoneyMeter: 502,
      })
      .returning({ id: shifts.id });
    await t.db.insert(shiftReadings).values({
      shiftId: id,
      nozzleId: nozzle!.id,
      openMeter: 0,
      closeMeter: 12.5,
      openMoney: 0,
      closeMoney: 502,
      pricePerLiter: 40.74,
    });

    const after = await t.caller().pos.dashboard();
    expect(after.todayShiftTotal - before.todayShiftTotal).toBe(502);
    expect(
      after.fuelByCode.GSH95!.amount - before.fuelByCode.GSH95!.amount
    ).toBe(502);
    expect(
      after.fuelByCode.GSH95!.liters - before.fuelByCode.GSH95!.liters
    ).toBe(12.5);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  fuelTanks,
  nozzles,
  products,
  saleItems,
  settings,
  shiftReadings,
  shifts,
  tankRefills,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

function bangkokToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: `${parts.year}-${parts.month}`,
    year: Number(parts.year),
  };
}

async function productByCode(code: string) {
  const product = await t.db.query.products.findFirst({
    where: eq(products.code, code),
  });
  if (!product) throw new Error(`ไม่พบสินค้า ${code}`);
  return product;
}

beforeAll(async () => {
  t = await setupTestDb();
  await t.db
    .update(settings)
    .set({ value: "0" })
    .where(
      and(eq(settings.branchId, 1), eq(settings.key, "promotion_enabled"))
    );
});

afterAll(() => t.cleanup());

describe("reports.profitability", () => {
  it("ใช้น้ำมันต้นทุนรับเข้าล่าสุด รวมกำไรทุกหมวด และหักค่าใช้จ่าย", async () => {
    const fuel = await productByCode("GSH95");
    const diesel = await productByCode("DB7");
    const lubricant = await productByCode("2T-PTT");
    const other = await productByCode("WATER");
    const manager = t.caller("manager");
    const [openShift] = await t.db
      .insert(shifts)
      .values({
        branchId: 1,
        staffId: 2,
        staffName: "ผู้จัดการทดสอบ",
        status: "open",
      })
      .returning({ id: shifts.id });

    const created = await manager.pos.createSale({
      shiftId: openShift.id,
      items: [
        { productId: fuel.id, qty: 2 },
        { productId: lubricant.id, qty: 2 },
        { productId: other.id, qty: 3 },
      ],
      discount: 7.4,
      paymentMethod: "cash",
      received: 300,
    });
    expect(created.sale.shiftId).toEqual(expect.any(Number));
    expect(created.items[0]).not.toHaveProperty("costPerUnit");
    await manager.expenses.create({
      title: "ค่าใช้จ่ายทดสอบกำไร",
      category: "ดำเนินงาน",
      amount: 10,
    });
    await t.db
      .update(shifts)
      .set({
        status: "closed",
        closedAt: new Date(),
        totalLiters: 5,
        totalAmount: 177.3,
        totalMoneyMeter: 178,
      })
      .where(eq(shifts.id, openShift.id));
    const fuelNozzle = await t.db.query.nozzles.findFirst({
      where: eq(nozzles.productId, fuel.id),
    });
    const dieselNozzle = await t.db.query.nozzles.findFirst({
      where: eq(nozzles.productId, diesel.id),
    });
    if (!fuelNozzle || !dieselNozzle) {
      throw new Error("ต้องมีหัวจ่ายน้ำมันทดสอบครบทุกประเภท");
    }
    await t.db.insert(shiftReadings).values([
      {
        branchId: 1,
        shiftId: openShift.id,
        nozzleId: fuelNozzle.id,
        openMeter: 100,
        closeMeter: 102,
        openMoney: 4_000,
        closeMoney: 4_082,
        pricePerLiter: 40.74,
        costPerLiter: 39.2,
      },
      {
        branchId: 1,
        shiftId: openShift.id,
        nozzleId: dieselNozzle.id,
        openMeter: 200,
        closeMeter: 203,
        openMoney: 5_000,
        closeMoney: 5_096,
        pricePerLiter: 31.94,
        costPerLiter: 30.6,
      },
    ]);

    const snapshots = await t.db
      .select({
        name: saleItems.name,
        costPerUnit: saleItems.costPerUnit,
        productCategory: saleItems.productCategory,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, created.sale.id));
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ costPerUnit: 39.2, productCategory: "fuel" }),
        expect.objectContaining({
          costPerUnit: 32,
          productCategory: "lubricant",
        }),
        expect.objectContaining({ costPerUnit: 5, productCategory: "other" }),
      ])
    );

    const fuelTank = await t.db.query.fuelTanks.findFirst({
      where: and(eq(fuelTanks.branchId, 1), eq(fuelTanks.productId, fuel.id)),
    });
    const dieselTank = await t.db.query.fuelTanks.findFirst({
      where: and(eq(fuelTanks.branchId, 1), eq(fuelTanks.productId, diesel.id)),
    });
    if (!fuelTank || !dieselTank) throw new Error("ต้องมีถังน้ำมันทดสอบ");
    const receivedAt = Date.now();
    await t.db.insert(tankRefills).values([
      {
        branchId: 1,
        tankId: fuelTank.id,
        liters: 1_000,
        costPerLiter: 35.5,
        createdAt: new Date(receivedAt - 1_000),
      },
      {
        branchId: 1,
        tankId: fuelTank.id,
        liters: 1_000,
        costPerLiter: 36.42,
        createdAt: new Date(receivedAt),
      },
      {
        branchId: 1,
        tankId: dieselTank.id,
        liters: 1_000,
        costPerLiter: 37.12,
        createdAt: new Date(receivedAt),
      },
    ]);

    // การแก้ต้นทุนหน้าสินค้าไม่แทนที่ต้นทุนรับเข้าล่าสุดของน้ำมัน
    for (const product of [fuel, diesel, lubricant, other]) {
      await t.db
        .update(products)
        .set({ cost: 999 })
        .where(eq(products.id, product.id));
    }

    const today = bangkokToday();
    const daily = await manager.reports.profitability({
      view: "day",
      date: today.date,
    });

    // 81.48 + 90 + 30 - ส่วนลด 7.40 = 194.08
    expect(daily.summary.revenue).toBe(194.08);
    // (2 × 36.42) + (2 × 32) + (3 × 5) = 151.84
    expect(daily.summary.cost).toBe(151.84);
    expect(daily.summary.grossProfit).toBe(42.24);
    expect(daily.summary.expenses).toBe(10);
    expect(daily.summary.netProfit).toBe(32.24);
    expect(daily.summary.billCount).toBe(1);
    expect(daily.summary.costCoveragePercent).toBe(100);
    expect(daily.zReport).toEqual(
      expect.objectContaining({
        totalSales: 194.08,
        billCount: 1,
        saleCount: 1,
        returnCount: 0,
        voidedCount: 0,
        voidedTotal: 0,
        discountTotal: 7.4,
        totalLiters: 2,
        expectedCash: 184.08,
        reconciliationDifference: 0,
      })
    );
    expect(daily.zReport.byMethod.cash).toEqual({
      count: 1,
      total: 194.08,
    });
    expect(daily.zReport.debtPayments.total).toBe(0);
    expect(daily.zReport.fuelLiters).toEqual([
      expect.objectContaining({ name: fuel.name, liters: 2 }),
    ]);
    const fuelCategory = daily.categories.find(
      category => category.key === "fuel"
    );
    if (!fuelCategory) throw new Error("ต้องมีสรุปหมวดน้ำมัน");
    const meterAdjustedRevenue =
      Math.round((178 + daily.summary.revenue - fuelCategory.revenue) * 100) /
      100;
    expect(daily.meterProfitSummary).toEqual(
      expect.objectContaining({
        available: true,
        closedShiftCount: 1,
        meterShiftCount: 1,
        fallbackShiftCount: 0,
        fuelRevenue: 178,
        fuelLiters: 5,
        averagePricePerLiter: 35.6,
        fuelRevenueFromPos: fuelCategory.revenue,
        fuelRevenueDifference:
          Math.round((178 - fuelCategory.revenue) * 100) / 100,
        fuelCost: 184.2,
        fuelCostCoveragePercent: 100,
        revenue: meterAdjustedRevenue,
        cost: 263.2,
        expenses: 10,
        netProfit: Math.round((meterAdjustedRevenue - 263.2 - 10) * 100) / 100,
      })
    );
    expect(daily.meterProfitSummary.fuelTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: fuel.id,
          code: "GSH95",
          name: fuel.name,
          liters: 2,
          revenue: 82,
          costPerLiter: 36.42,
          cost: 72.84,
          profitPerLiter: 4.58,
          profit: 9.16,
          usesLatestReceivedCost: true,
        }),
        expect.objectContaining({
          productId: diesel.id,
          code: "DB7",
          name: diesel.name,
          liters: 3,
          revenue: 96,
          costPerLiter: 37.12,
          cost: 111.36,
          profitPerLiter: -5.12,
          profit: -15.36,
          usesLatestReceivedCost: true,
        }),
      ])
    );
    expect(daily.meterProfitSummary.fuelTypes).toHaveLength(2);
    expect(
      daily.meterProfitSummary.trend.reduce(
        (sum, bucket) => sum + bucket.revenue,
        0
      )
    ).toBe(178);
    expect(
      daily.meterProfitSummary.trend.reduce(
        (sum, bucket) => sum + bucket.liters,
        0
      )
    ).toBe(5);
    expect(daily.categories.map(category => category.key)).toEqual([
      "fuel",
      "lubricant",
      "other",
    ]);
    expect(daily.products).toHaveLength(3);
    expect(daily.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: fuel.id,
          averageCost: 36.42,
          cost: 72.84,
        }),
      ])
    );
    expect(daily.trend).toHaveLength(24);
    expect(daily.availableShifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.sale.shiftId }),
      ])
    );
    expect(daily.shiftSummaries).toEqual([
      expect.objectContaining({
        shiftId: created.sale.shiftId,
        billCount: 1,
        revenue: 194.08,
        cost: 151.84,
        grossProfit: 42.24,
        expenses: 10,
        netProfit: 32.24,
      }),
    ]);

    // Z-Report บนหน้ากำไรต้องอ้างยอดชุดเดียวกับรายงานปิดวันเดิม
    const originalZReport = await manager.reports.daily({ date: today.date });
    expect(daily.zReport).toEqual(
      expect.objectContaining({
        totalSales: originalZReport.totalSales,
        billCount: originalZReport.billCount,
        voidedCount: originalZReport.voidedCount,
        voidedTotal: originalZReport.voidedTotal,
        discountTotal: originalZReport.discountTotal,
        vatTotal: originalZReport.vatTotal,
        byMethod: originalZReport.byMethod,
        totalLiters: originalZReport.totalLiters,
        expectedCash: originalZReport.expectedCash,
      })
    );
    expect(daily.zReport.debtPayments).toEqual(
      expect.objectContaining({
        total: originalZReport.debtPayments.total,
        byMethod: originalZReport.debtPayments.byMethod,
      })
    );

    if (created.sale.shiftId == null) {
      throw new Error("รายการขายทดสอบต้องผูกกับกะ");
    }
    const shiftOnly = await manager.reports.profitability({
      view: "day",
      date: today.date,
      shiftId: created.sale.shiftId,
    });
    expect(shiftOnly.period.shiftId).toBe(created.sale.shiftId);
    expect(shiftOnly.summary.netProfit).toBe(32.24);
    expect(shiftOnly.shiftSummaries).toHaveLength(1);

    const monthly = await manager.reports.profitability({
      view: "month",
      month: today.month,
    });
    const yearly = await manager.reports.profitability({
      view: "year",
      year: today.year,
    });
    expect(monthly.summary.netProfit).toBe(32.24);
    expect(monthly.meterProfitSummary.fuelRevenue).toBe(178);
    expect(monthly.meterProfitSummary.fuelLiters).toBe(5);
    expect(monthly.trend.length).toBeGreaterThanOrEqual(28);
    expect(yearly.summary.netProfit).toBe(32.24);
    expect(yearly.meterProfitSummary.fuelRevenue).toBe(178);
    expect(yearly.meterProfitSummary.fuelLiters).toBe(5);
    expect(yearly.trend).toHaveLength(12);

    // กะเก่าที่ไม่มีมิเตอร์ P ต้องใช้ยอดลิตร × ราคาที่บันทึกไว้แทน
    await t.db
      .update(shifts)
      .set({ totalMoneyMeter: 0 })
      .where(eq(shifts.id, openShift.id));
    const legacyMeter = await manager.reports.profitability({
      view: "day",
      date: today.date,
    });
    expect(legacyMeter.meterProfitSummary).toEqual(
      expect.objectContaining({
        available: true,
        meterShiftCount: 0,
        fallbackShiftCount: 1,
        fuelRevenue: 177.3,
        fuelLiters: 5,
      })
    );

    // รับเข้าน้ำมันรอบใหม่แล้วเรียกรายงานอีกครั้ง ต้องเปลี่ยนต้นทุนชนิดนั้นทันที
    await t.db.insert(tankRefills).values({
      branchId: 1,
      tankId: fuelTank.id,
      liters: 1_000,
      costPerLiter: 36.9,
      createdAt: new Date(receivedAt + 1_000),
    });
    const afterNextRefill = await manager.reports.profitability({
      view: "day",
      date: today.date,
    });
    expect(afterNextRefill.meterProfitSummary.fuelTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: fuel.id,
          costPerLiter: 36.9,
          cost: 73.8,
          usesLatestReceivedCost: true,
        }),
        expect.objectContaining({
          productId: diesel.id,
          costPerLiter: 37.12,
          cost: 111.36,
          usesLatestReceivedCost: true,
        }),
      ])
    );
  });

  it.each([
    {
      closeMoney: 500,
      revenue: 500,
      meterShiftCount: 1,
      fallbackShiftCount: 0,
    },
    {
      closeMoney: null,
      revenue: 407.4,
      meterShiftCount: 0,
      fallbackShiftCount: 1,
    },
  ])(
    "แยก P เริ่มต้นศูนย์และ P ปิด $closeMoney จากข้อมูล P ที่ยังไม่มี",
    async ({ closeMoney, revenue, meterShiftCount, fallbackShiftCount }) => {
      const fuel = await productByCode("GSH95");
      const nozzle = await t.db.query.nozzles.findFirst({
        where: eq(nozzles.productId, fuel.id),
      });
      if (!nozzle) throw new Error("ต้องมีหัวจ่ายน้ำมันทดสอบ");
      const [shift] = await t.db
        .insert(shifts)
        .values({
          branchId: 1,
          staffId: 2,
          staffName: "ผู้จัดการทดสอบกะแรก",
          status: "closed",
          openedAt: new Date("2000-01-02T01:00:00.000Z"),
          closedAt: new Date("2000-01-02T02:00:00.000Z"),
          totalLiters: 10,
          totalAmount: 407.4,
          totalMoneyMeter: closeMoney ?? 0,
        })
        .returning({ id: shifts.id });
      await t.db.insert(shiftReadings).values({
        branchId: 1,
        shiftId: shift.id,
        nozzleId: nozzle.id,
        openMeter: 0,
        closeMeter: 10,
        openMoney: 0,
        closeMoney,
        pricePerLiter: 40.74,
        costPerLiter: 39.2,
      });

      const report = await t.caller("manager").reports.profitability({
        view: "day",
        date: "2000-01-02",
        shiftId: shift.id,
      });

      expect(report.meterProfitSummary).toMatchObject({
        available: true,
        meterShiftCount,
        fallbackShiftCount,
        fuelRevenue: revenue,
        fuelLiters: 10,
        fuelTypes: [
          expect.objectContaining({ productId: fuel.id, revenue, liters: 10 }),
        ],
      });
    }
  );

  it("ปฏิเสธพนักงานขายไม่ให้เห็นต้นทุนและกำไร", async () => {
    await expect(
      t.caller("cashier").reports.profitability({
        view: "day",
        date: bangkokToday().date,
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

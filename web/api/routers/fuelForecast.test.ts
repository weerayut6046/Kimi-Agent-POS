import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  branches,
  fuelTanks,
  nozzles,
  products,
  pumps,
  saleItems,
  sales,
  settings,
  shiftReadings,
  shifts,
  staffUsers,
} from "@db/schema";
import {
  DEFAULT_FUEL_FORECAST_SETTINGS,
  FUEL_FORECAST_SETTINGS_KEY,
} from "@contracts/fuelForecast";
import {
  calculateFuelForecast,
  fuelForecastPeriod,
  queryFuelForecast,
} from "../lib/fuelForecast";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;
let sequence = 0;
const NOW = new Date("2026-09-27T05:00:00Z"); // noon in Bangkok
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

async function fixture(stock = 1_000, capacity = 2_000) {
  const id = ++sequence;
  const [branch] = await t.db
    .insert(branches)
    .values({ code: `FC-${id}`, name: `Forecast ${id}` })
    .returning();
  const [product] = await t.db
    .insert(products)
    .values({
      branchId: branch.id,
      code: `F-${id}`,
      name: "Diesel",
      category: "fuel",
      price: 30,
      unit: "ลิตร",
    })
    .returning();
  const [tank] = await t.db
    .insert(fuelTanks)
    .values({
      branchId: branch.id,
      productId: product.id,
      name: "Tank A",
      currentLiters: stock,
      capacityLiters: capacity,
    })
    .returning();
  const [pump] = await t.db
    .insert(pumps)
    .values({ branchId: branch.id, name: "Pump" })
    .returning();
  const [nozzle] = await t.db
    .insert(nozzles)
    .values({
      branchId: branch.id,
      pumpId: pump.id,
      productId: product.id,
      tankId: tank.id,
      label: "A",
    })
    .returning();
  return { branch, product, tank, pump, nozzle };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function meter(f: Fixture, day: string, liters = 100) {
  const [shift] = await t.db
    .insert(shifts)
    .values({
      branchId: f.branch.id,
      staffName: "Test",
      status: "closed",
      openedAt: new Date(`${day}T08:00:00+07:00`),
      closedAt: new Date(`${day}T12:00:00+07:00`),
      totalLiters: liters,
    })
    .returning();
  const [reading] = await t.db
    .insert(shiftReadings)
    .values({
      branchId: f.branch.id,
      shiftId: shift.id,
      nozzleId: f.nozzle.id,
      openMeter: 1_000,
      closeMeter: 1_000 + liters,
    })
    .returning();
  return { shift, reading };
}
async function week(f: Fixture, liters = 100) {
  const result = [];
  for (let day = 20; day <= 26; day++)
    result.push(await meter(f, `2026-09-${day}`, liters));
  return result;
}
async function pos(
  f: Fixture,
  day: string,
  qty: number,
  shiftId: number | null = null,
  transactionType: "sale" | "return" = "sale",
  status: "completed" | "voided" = "completed"
) {
  const [sale] = await t.db
    .insert(sales)
    .values({
      branchId: f.branch.id,
      receiptNo: `F-${++sequence}`,
      shiftId,
      transactionType,
      status,
      subtotal: qty * 30,
      total: qty * 30,
      createdAt: new Date(`${day}T10:00:00+07:00`),
    })
    .returning();
  await t.db.insert(saleItems).values({
    branchId: f.branch.id,
    saleId: sale.id,
    productId: f.product.id,
    name: "Diesel",
    productCategory: "fuel",
    qty,
    unitPrice: 30,
    amount: qty * 30,
  });
  return sale;
}
async function summary(f: Fixture, lookbackDays: 7 | 30 = 7) {
  return queryFuelForecast(t.db, { lookbackDays }, f.branch.id, NOW);
}

describe("fuel forecast calculations", () => {
  it("uses completed Bangkok calendar days across the UTC midnight boundary", () => {
    const period = fuelForecastPeriod(7, new Date("2026-09-26T18:00:00Z"));
    expect(period).toEqual({
      start: new Date("2026-09-19T17:00:00Z"),
      end: new Date("2026-09-26T17:00:00Z"),
      periodStart: "2026-09-20",
      periodEnd: "2026-09-26",
    });
  });
  it("plans future delivery from the reorder date and caps purchase to capacity", () => {
    const healthy = calculateFuelForecast(
      1_000,
      2_000,
      100,
      DEFAULT_FUEL_FORECAST_SETTINGS,
      NOW
    );
    expect(healthy).toMatchObject({
      status: "ok",
      daysLeft: 10,
      orderByDate: "2026-10-03",
      expectedDeliveryDate: "2026-10-05",
      expectedEmptyDate: "2026-10-07",
      projectedDeliveryLiters: 250,
      reorderPointLiters: 400,
      suggestedOrderLiters: 450,
    });
    expect(
      calculateFuelForecast(150, 500, 100, DEFAULT_FUEL_FORECAST_SETTINGS, NOW)
    ).toMatchObject({
      status: "urgent",
      projectedDeliveryLiters: 0,
      suggestedOrderLiters: 500,
      capacityWarning: true,
      orderByDate: "2026-09-27",
      expectedDeliveryDate: "2026-09-29",
    });
    expect(
      calculateFuelForecast(
        400,
        2_000,
        100,
        DEFAULT_FUEL_FORECAST_SETTINGS,
        NOW
      )
    ).toMatchObject({ status: "order_now", suggestedOrderLiters: 450 });
  });
  it("keeps date-only plans safe at earliest delivery and marks orders due today", () => {
    const result = calculateFuelForecast(
      950,
      1_000,
      100,
      { ...DEFAULT_FUEL_FORECAST_SETTINGS, targetCoverDays: 10 },
      new Date("2026-09-27T02:00:00Z")
    );
    expect(result).toMatchObject({
      projectedDeliveryLiters: 287.5,
      suggestedOrderLiters: 712.5,
      expectedDeliveryDate: "2026-10-04",
    });
    expect(
      result.projectedDeliveryLiters! + result.suggestedOrderLiters!
    ).toBeLessThanOrEqual(1_000);
    expect(
      calculateFuelForecast(
        450,
        1_000,
        100,
        DEFAULT_FUEL_FORECAST_SETTINGS,
        new Date("2026-09-27T02:00:00Z")
      )
    ).toMatchObject({ status: "order_now", orderByDate: "2026-09-27" });
    expect(
      calculateFuelForecast(100, 1_000, 0, DEFAULT_FUEL_FORECAST_SETTINGS, NOW)
    ).toMatchObject({ status: "insufficient_data", daysLeft: null });
    expect(
      calculateFuelForecast(100, 1_000, -2, DEFAULT_FUEL_FORECAST_SETTINGS, NOW)
    ).toMatchObject({
      status: "insufficient_data",
      suggestedOrderLiters: null,
    });
  });
});

describe("fuelForecast.summary", () => {
  it("counts meters once, includes inactive nozzle history and excludes today and open shifts", async () => {
    const f = await fixture();
    const history = await week(f);
    for (let i = 0; i < history.length; i++)
      await pos(f, `2026-09-${20 + i}`, 100, history[i]!.shift.id);
    await pos(f, "2026-09-25", 100); // no shift, overlaps an already metered day
    await meter(f, "2026-09-27", 9_000);
    const [open] = await t.db
      .insert(shifts)
      .values({
        branchId: f.branch.id,
        staffName: "Open",
        openedAt: new Date("2026-09-27T06:00:00+07:00"),
      })
      .returning();
    await t.db.insert(shiftReadings).values({
      branchId: f.branch.id,
      shiftId: open.id,
      nozzleId: f.nozzle.id,
      openMeter: 2_000,
    });
    await t.db
      .update(nozzles)
      .set({ active: false })
      .where(eq(nozzles.id, f.nozzle.id));
    const result = await summary(f);
    expect(result.periodStart).toBe("2026-09-20");
    expect(result.tanks[0]).toMatchObject({
      status: "ok",
      historical: {
        totalLiters: 700,
        averageDailyLiters: 100,
        calendarDays: 7,
        evidenceDays: 7,
        meterShifts: 7,
        posBills: 0,
        source: "meters",
      },
    });
    expect(result.tanks[0]!.warnings.join(" ")).toContain("มีกะเปิดอยู่");
    expect(result.tanks[0]!.warnings.join(" ")).toContain(
      "การผูกหัวจ่ายกับถังปัจจุบัน"
    );
  });
  it("includes zero days in the selected denominator only after history is established", async () => {
    const f = await fixture();
    await week(f);
    const fresh = await summary(f, 30);
    expect(fresh.tanks[0]).toMatchObject({
      status: "insufficient_data",
      daysLeft: null,
      historical: { totalLiters: 700, averageDailyLiters: 23.333 },
    });
    expect(fresh.tanks[0]!.warnings.join(" ")).toContain("เริ่มหลังวันแรก");
    await meter(f, "2026-08-01", 10);
    expect((await summary(f, 30)).tanks[0]).toMatchObject({
      status: "ok",
      historical: {
        totalLiters: 700,
        averageDailyLiters: 23.333,
        evidenceDays: 7,
      },
    });
  });
  it("recognizes valid zero-meter days while withholding dates for zero or short history", async () => {
    const zero = await fixture();
    await week(zero, 0);
    expect((await summary(zero)).tanks[0]).toMatchObject({
      status: "insufficient_data",
      historical: { totalLiters: 0, evidenceDays: 7, source: "meters" },
      expectedEmptyDate: null,
    });
    const short = await fixture();
    await meter(short, "2026-09-26", 100);
    expect((await summary(short)).tanks[0]).toMatchObject({
      status: "insufficient_data",
      historical: { evidenceDays: 1 },
      suggestedOrderLiters: null,
    });
  });
  it("allocates each nozzle to its own tank even with the same fuel product", async () => {
    const f = await fixture();
    await week(f, 100);
    const [tankB] = await t.db
      .insert(fuelTanks)
      .values({
        branchId: f.branch.id,
        productId: f.product.id,
        name: "B",
        currentLiters: 500,
        capacityLiters: 2_000,
      })
      .returning();
    const [nozzleB] = await t.db
      .insert(nozzles)
      .values({
        branchId: f.branch.id,
        productId: f.product.id,
        tankId: tankB.id,
        pumpId: f.pump.id,
        label: "B",
      })
      .returning();
    await week({ ...f, tank: tankB, nozzle: nozzleB }, 200);
    const result = await summary(f);
    expect(result.tanks.find(tank => tank.tankId === f.tank.id)).toMatchObject({
      historical: { totalLiters: 700, averageDailyLiters: 100 },
      status: "ok",
    });
    expect(result.tanks.find(tank => tank.tankId === tankB.id)).toMatchObject({
      historical: { totalLiters: 1_400, averageDailyLiters: 200 },
      status: "order_now",
    });
    await pos(f, "2026-09-21", 80, null); // omitted because meters cover this day
    expect((await summary(f)).tanks[0]!.historical.totalLiters).toBe(700);
  });
  it("shows POS fallback as unconfirmed physical demand, nets returns and excludes voids", async () => {
    const f = await fixture();
    for (let day = 20; day <= 26; day++) await pos(f, `2026-09-${day}`, 100);
    await pos(f, "2026-09-25", -20, null, "return");
    await pos(f, "2026-09-25", 5_000, null, "sale", "voided");
    const result = (await summary(f)).tanks[0]!;
    expect(result).toMatchObject({
      status: "insufficient_data",
      suggestedOrderLiters: null,
      historical: {
        totalLiters: 680,
        averageDailyLiters: 97.143,
        evidenceDays: 7,
        source: "pos",
        posBills: 8,
      },
    });
    expect(result.warnings.join(" ")).toContain("POS ไม่ยืนยัน");
  });
  it.each(["negative", "missing", "duplicate", "aggregate"] as const)(
    "withholds projections for %s meter data",
    async kind => {
      const f = await fixture();
      const history = await week(f);
      const first = history[0]!;
      if (kind === "negative")
        await t.db
          .update(shiftReadings)
          .set({ closeMeter: 999 })
          .where(eq(shiftReadings.id, first.reading.id));
      if (kind === "missing")
        await t.db
          .update(shiftReadings)
          .set({ closeMeter: null })
          .where(eq(shiftReadings.id, first.reading.id));
      if (kind === "duplicate")
        await t.db.insert(shiftReadings).values({
          branchId: f.branch.id,
          shiftId: first.shift.id,
          nozzleId: f.nozzle.id,
          openMeter: 1_000,
          closeMeter: 1_100,
        });
      if (kind === "aggregate")
        await t.db
          .update(shifts)
          .set({ totalLiters: 500 })
          .where(eq(shifts.id, first.shift.id));
      await pos(f, "2026-09-20", 100, first.shift.id);
      const result = (await summary(f)).tanks[0]!;
      expect(result.status).toBe("insufficient_data");
      expect(result.suggestedOrderLiters).toBeNull();
      expect(result.historical.posBills).toBe(0); // invalid meters must not trigger double-counted fallback
    }
  );
  it("does not fabricate tank volumes for aggregate-only shifts or unassigned nozzles", async () => {
    const f = await fixture();
    await week(f);
    await t.db.insert(shifts).values({
      branchId: f.branch.id,
      staffName: "Legacy",
      status: "closed",
      openedAt: new Date("2026-09-25T18:00:00+07:00"),
      closedAt: new Date("2026-09-25T19:00:00+07:00"),
      totalLiters: 500,
    });
    const result = (await summary(f)).tanks[0]!;
    expect(result).toMatchObject({
      status: "insufficient_data",
      historical: { totalLiters: 700 },
    });
    expect(result.warnings.join(" ")).toContain("จัดสรรยอดให้ถังไม่ได้");
    await t.db
      .update(nozzles)
      .set({ tankId: null })
      .where(eq(nozzles.id, f.nozzle.id));
    expect((await summary(f)).tanks[0]).toMatchObject({
      status: "insufficient_data",
      historical: { totalLiters: 0 },
    });
  });
  it("detects overlapping meter shifts across the lookback boundary", async () => {
    const f = await fixture();
    const previous = await meter(f, "2026-09-19", 100);
    await t.db
      .update(shifts)
      .set({
        openedAt: new Date("2026-09-19T21:00:00+07:00"),
        closedAt: new Date("2026-09-19T23:00:00+07:00"),
      })
      .where(eq(shifts.id, previous.shift.id));
    const history = await week(f);
    await t.db
      .update(shifts)
      .set({ openedAt: new Date("2026-09-19T22:00:00+07:00") })
      .where(eq(shifts.id, history[0]!.shift.id));
    const result = (await summary(f)).tanks[0]!;
    expect(result.status).toBe("insufficient_data");
    expect(result.warnings.join(" ")).toContain("ช่วงเวลากะซ้อนกัน");
  });
  it("does not divide unassigned POS volumes between tanks of the same product", async () => {
    const f = await fixture();
    await t.db
      .insert(fuelTanks)
      .values({
        branchId: f.branch.id,
        productId: f.product.id,
        name: "B",
        capacityLiters: 1_000,
      });
    await pos(f, "2026-09-26", 800);
    const result = await summary(f);
    expect(
      result.tanks.every(
        tank =>
          tank.status === "insufficient_data" &&
          tank.historical.totalLiters === 0
      )
    ).toBe(true);
    expect(result.tanks[0]!.warnings.join(" ")).toContain(
      "ไม่แบ่งยอดโดยประมาณ"
    );
  });
  it("isolates tank stock, meter history and settings by branch", async () => {
    const main = await fixture();
    const other = await fixture(50);
    await week(main, 100);
    await week(other, 10);
    const result = await summary(main);
    expect(result.tanks.map(tank => tank.tankId)).toEqual([main.tank.id]);
    expect(result.tanks[0]!.historical.totalLiters).toBe(700);
    expect((await summary(other)).tanks[0]!.historical.totalLiters).toBe(70);
  });
});

describe("fuelForecast settings and authorization", () => {
  it("saves independent policies without replacing other tanks or branches", async () => {
    const f = await fixture();
    const other = await fixture();
    const [tankB] = await t.db
      .insert(fuelTanks)
      .values({
        branchId: f.branch.id,
        productId: f.product.id,
        name: "B",
        capacityLiters: 1_000,
      })
      .returning();
    const caller = t.caller("admin", 1, f.branch.id);
    await caller.fuelForecast.saveSettings({
      tankId: f.tank.id,
      leadTimeDays: 3,
      safetyStockDays: 1,
      targetCoverDays: 8,
    });
    await caller.fuelForecast.saveSettings({
      tankId: tankB.id,
      leadTimeDays: 1,
      safetyStockDays: 1,
      targetCoverDays: 5,
    });
    const [saved] = await t.db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.branchId, f.branch.id),
          eq(settings.key, FUEL_FORECAST_SETTINGS_KEY)
        )
      );
    expect(JSON.parse(saved!.value)).toEqual({
      [f.tank.id]: { leadTimeDays: 3, safetyStockDays: 1, targetCoverDays: 8 },
      [tankB.id]: { leadTimeDays: 1, safetyStockDays: 1, targetCoverDays: 5 },
    });
    expect((await summary(f)).tanks[0]!.settings.targetCoverDays).toBe(8);
    expect((await summary(other)).tanks[0]!.settings).toEqual(
      DEFAULT_FUEL_FORECAST_SETTINGS
    );
    await expect(
      caller.fuelForecast.saveSettings({
        tankId: other.tank.id,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.fuelForecast.saveSettings({
        tankId: f.tank.id,
        leadTimeDays: 2,
        safetyStockDays: 2,
        targetCoverDays: 4,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("normalizes corrupt stored JSON and replaces it safely on save", async () => {
    const f = await fixture();
    await t.db.insert(settings).values({
      branchId: f.branch.id,
      key: FUEL_FORECAST_SETTINGS_KEY,
      value: "broken json",
    });
    expect((await summary(f)).tanks[0]!.settings).toEqual(
      DEFAULT_FUEL_FORECAST_SETTINGS
    );
    await t.caller("admin", 1, f.branch.id).fuelForecast.saveSettings({
      tankId: f.tank.id,
      ...DEFAULT_FUEL_FORECAST_SETTINGS,
    });
    expect((await summary(f)).tanks[0]!.settings).toEqual(
      DEFAULT_FUEL_FORECAST_SETTINGS
    );
  });
  it("authenticates reads, enforces menu permissions on both procedures and manager write ceiling", async () => {
    await expect(
      t.anonymousCaller().fuelForecast.summary()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      t.anonymousCaller().fuelForecast.saveSettings({
        tankId: 1,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await t.caller("cashier").fuelForecast.summary()).timezone).toBe(
      "Asia/Bangkok"
    );
    await expect(
      t.caller("cashier").fuelForecast.saveSettings({
        tankId: 1,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await t
      .caller("admin")
      .auth.updateStaff({ id: 2, menuPermissions: ["stock"] });
    await expect(
      t.caller("manager").fuelForecast.summary()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.caller("manager").fuelForecast.saveSettings({
        tankId: 1,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await t
      .caller("admin")
      .auth.updateStaff({ id: 2, menuPermissions: ["fuel_forecast"] });
    expect(
      (await t.caller("manager").fuelForecast.summary({ lookbackDays: 7 }))
        .lookbackDays
    ).toBe(7);
    await expect(
      t.caller("manager").fuelForecast.saveSettings({
        tankId: 1,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      })
    ).resolves.toMatchObject({ ok: true });
    await t.db
      .update(staffUsers)
      .set({ menuPermissions: [] })
      .where(eq(staffUsers.id, 1));
    expect((await t.caller("admin").fuelForecast.summary()).timezone).toBe(
      "Asia/Bangkok"
    );
  });
});

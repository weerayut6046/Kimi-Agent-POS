import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  createPortableDatabaseBackup,
  restorePortableDatabaseBackup,
} from "../lib/portableDatabaseBackup";
import {
  attendanceEvents,
  attendanceSessions,
  fuelCostOpenings,
  staffUsers,
  tankWithdrawals,
} from "@db/schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bangkokDateKey } from "../lib/dates";
import { and, eq } from "drizzle-orm";
import { products, sales, saleItems, settings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { buildOfflineReceipt } from "../../../desktop/electron/offlineRuntime";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await t.db
    .update(settings)
    .set({ value: "0" })
    .where(
      and(eq(settings.branchId, 1), eq(settings.key, "promotion_enabled"))
    );
});
afterAll(async () => {
  if (t) await t.cleanup();
});
const product = async (code: string) =>
  (await t.db.query.products.findFirst({ where: eq(products.code, code) }))!;
async function sample(
  receiptNo: string,
  at: string,
  code: string,
  qty: number,
  unitPrice: number
) {
  const p = await product(code);
  const amount = Math.round(qty * unitPrice * 100) / 100;
  const [row] = await t.db
    .insert(sales)
    .values({
      branchId: 1,
      receiptNo,
      total: amount,
      subtotal: amount,
      createdAt: new Date(at),
    })
    .returning();
  await t.db.insert(saleItems).values({
    branchId: 1,
    saleId: row.id,
    productId: p.id,
    name: p.name,
    productCategory: p.category,
    qty,
    unit: p.unit,
    unitPrice,
    amount,
  });
}
it("single fill shown on meter and POS, counted cash, closed-shift offline retry", async () => {
  const p = await product("GSH95");
  const nz = await t.db.query.nozzles.findMany();
  const first = nz.find(n => n.productId === p.id)!;
  const before = await t.caller("admin").pos.dashboard();
  const shift = await t.caller().pos.openShift({
    staffName: "test",
    openingFloat: 100,
    readings: nz.map(n => ({
      nozzleId: n.id,
      openMeter: n.currentMeter,
      openMoney: n.currentMoney,
    })),
  });
  const input = {
    shiftId: shift.shiftId,
    clientReceiptNo: "OFF-ABC123-20261122090100-0001",
    clientCreatedAt: new Date(),
    items: [{ productId: p.id, qty: 10 }],
    paymentMethod: "cash" as const,
    received: 407.4,
  };
  const sold = await t.caller().pos.createSale(input);
  expect(sold.sale.total).toEqual(407.4);
  await t.caller().pos.closeShift({
    shiftId: shift.shiftId,
    countedCash: 507.4,
    readings: nz.map(n => ({
      nozzleId: n.id,
      closeMeter: n.currentMeter + (n.id === first.id ? 10 : 0),
      closeMoney: n.currentMoney + (n.id === first.id ? 407.4 : 0),
    })),
  });
  const after = await t.caller("admin").pos.dashboard();
  const summary = await t
    .caller("admin")
    .reports.daily({ date: bangkokDateKey(new Date()) });
  const row = summary.shifts.find(s => s.id === shift.shiftId)!;
  expect(after.todayTotal - before.todayTotal).toBeCloseTo(407.4, 2);
  expect(after.todayShiftTotal - before.todayShiftTotal).toBeCloseTo(407.4, 2);
  expect(row).toMatchObject({
    cashExpected: 507.4,
    countedCash: 507.4,
    cashDiff: 0,
    cashDiffP: 0,
  });
  const retry = await t.caller().pos.createSale(input);
  expect(retry.sale.id).toBe(sold.sale.id);
});
it("three sales each measured to the milliliter", async () => {
  for (let i = 1; i <= 3; i++)
    await sample("AUD-L-" + i, "2025-04-10T05:00:00Z", "GSH95", 10.004, 40);
  const report = await t.caller("admin").reports.daily({ date: "2025-04-10" });
  expect(report.totalLiters).toBe(30.012);
});
it("Thai daily report includes just after Thai midnight, excludes next day", async () => {
  await sample("AUD-EARLY", "2025-04-11T17:30:00Z", "WATER", 1, 100);
  await sample("AUD-NEXT", "2025-04-12T17:30:00Z", "WATER", 1, 300);
  const report = await t.caller("admin").reports.daily({ date: "2025-04-12" });
  expect(report.totalSales).toBe(100);
});
it("void restores repeated lines of the same item", async () => {
  const p = await product("WATER");
  const sold = await t.caller().pos.createSale({
    items: [
      { productId: p.id, qty: 2 },
      { productId: p.id, qty: 3 },
    ],
    received: 50,
  });
  const reduced = (await product("WATER")).stockQty;
  await t.caller("admin").pos.voidSale({ id: sold.sale.id });
  expect(p.stockQty - reduced).toBe(5);
  expect((await product("WATER")).stockQty).toBe(p.stockQty);
});
it("offline receipt has matching amount when uploaded after a price change", async () => {
  const p = await product("TISSUE");
  const input = {
    staffName: "test",
    items: [{ productId: p.id, qty: 2 }],
    paymentMethod: "qr" as const,
    discount: 0,
    received: 0,
    pointsToRedeem: 0,
  };
  const nozzles = await t.db.query.nozzles.findMany();
  const { shiftId } = await t.caller().pos.openShift({
    staffName: "offline",
    readings: nozzles.map(n => ({
      nozzleId: n.id,
      openMeter: n.currentMeter,
      openMoney: n.currentMoney,
    })),
  });
  const time = new Date();
  const no = "OFF-ABC123-20261122090200-0002";
  const local = buildOfflineReceipt(
    {
      input,
      context: {
        vatRate: 7,
        pointEarnPerBaht: 100,
        pointRedeemValue: 1,
        promotionActive: false,
        memberName: null,
        customerName: null,
      },
      lines: [
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          unitPrice: 20,
          category: "other",
          qty: 2,
        },
      ],
    },
    no,
    time,
    -1
  );
  await t.caller("admin").catalog.updateProduct({ id: p.id, price: 25 });
  const {
    subtotal,
    discount,
    vatAmount,
    vatRate,
    total,
    pointsEarned,
    pointsRedeemed,
  } = local.sale;
  const snapshot = {
    subtotal,
    discount,
    vatAmount,
    vatRate,
    total,
    pointsEarned,
    pointsRedeemed,
    unitPrices: local.items.map(i => i.unitPrice),
  };
  const remote = {
    ...input,
    shiftId,
    clientReceiptNo: no,
    clientCreatedAt: time,
    offlineReceipt: snapshot,
  };
  await expect(
    t
      .caller()
      .pos.createSale({ ...remote, offlineReceipt: { ...snapshot, total: 50 } })
  ).rejects.toThrow("ใบเสร็จ");
  const central = await t.caller().pos.createSale(remote);
  expect(local.sale.total).toBe(40);
  expect(central.sale.total).toBe(local.sale.total);
  expect(central.items[0]?.unitPrice).toBe(20);
  // A lost acknowledgement must not silently clear a conflicting printed receipt.
  await expect(
    t
      .caller()
      .pos.createSale({ ...remote, offlineReceipt: { ...snapshot, total: 41 } })
  ).rejects.toThrow("ใบเสร็จ");
  await t.caller().pos.closeShift({
    shiftId,
    readings: nozzles.map(n => ({
      nozzleId: n.id,
      closeMeter: n.currentMeter,
      closeMoney: n.currentMoney,
    })),
  });
});
it("concurrent payments respect outstanding balance", async () => {
  const person = await t
    .caller("manager")
    .customers.create({ name: "Audit Customer" });
  const p = await product("WATER");
  await t.caller().pos.createSale({
    paymentMethod: "credit",
    customerId: person!.id,
    items: [{ productId: p.id, qty: 10 }],
  });
  const req = {
    customerId: person!.id,
    amount: 100,
    method: "cash" as const,
    staffName: "audit",
  };
  const results = await Promise.allSettled([
    t.caller("manager").credit.receivePayment(req),
    t.caller("manager").credit.receivePayment(req),
  ]);
  const detail = await t
    .caller("manager")
    .credit.detail({ customerId: person!.id });
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(detail.outstanding).toBe(0);
});
it("fuel used on a shift without a matching POS bill is accounted in reconstructed physical opening stock", async () => {
  const p = await product("DB7");
  const now = new Date(),
    year = Number(
      new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
      }).format(now)
    );
  const nz = await t.db.query.nozzles.findMany();
  const first = nz.find(n => n.productId === p.id)!;
  const manager = t.caller("manager");
  const reportRow = async () => {
    const result = await manager.reports.fuelStockSummary({
      view: "monthly",
      year,
    });
    return result.periods.at(-1)!.products.find(v => v.productId === p.id)!;
  };
  const before = await reportRow();
  const { shiftId } = await t.caller().pos.openShift({
    staffName: "audit",
    readings: nz.map(n => ({
      nozzleId: n.id,
      openMeter: n.currentMeter,
      openMoney: n.currentMoney,
    })),
  });
  await t.caller().pos.closeShift({
    shiftId,
    readings: nz.map(n => ({
      nozzleId: n.id,
      closeMeter: n.currentMeter + (n.id === first.id ? 10 : 0),
      closeMoney:
        n.currentMoney +
        (n.id === first.id ? Math.round(p.price * 10 * 100) / 100 : 0),
    })),
  });
  const after = await reportRow();
  expect(after.openingStock).toBe(before.openingStock);
  expect(after.closingStock).toBe(before.closingStock - 10);
});
it("fuel costing movement export can reconcile every underlying row and the totals", async () => {
  const p = await product("DB7");
  const mgr = t.caller("manager");
  await mgr.fuelCosting.setOpening({
    productId: p.id,
    effectiveAt: new Date("2025-01-01T00:00:00+07:00"),
    liters: 2000,
    unitCost: 30,
    note: "audit",
  });
  const [bill] = await t.db
    .insert(sales)
    .values({
      branchId: 1,
      receiptNo: "AUD-COST-CSV",
      subtotal: 40040,
      total: 40040,
      vatRate: 0,
      vatAmount: 0,
      createdAt: new Date("2025-01-15T09:00:00+07:00"),
    })
    .returning();
  const items = Array.from({ length: 1001 }, () => ({
    branchId: 1,
    saleId: bill.id,
    productId: p.id,
    productCategory: "fuel" as const,
    name: p.name,
    qty: 1,
    unit: p.unit,
    unitPrice: 40,
    amount: 40,
  }));
  await t.db.insert(saleItems).values(items);
  const range = { from: "2025-01-01", to: "2025-01-31" };
  const preview = await mgr.fuelCosting.report(range);
  expect(preview.items.find(v => v.id === p.id)?.ledger?.rows).toHaveLength(
    1000
  );
  const result = await mgr.fuelCosting.report({ ...range, fullDetails: true });
  const ledger = result.items.find(v => v.id === p.id)!.ledger!;
  expect([ledger.revenue, ledger.costOfSales, ledger.grossProfit]).toEqual([
    40040, 30030, 10010,
  ]);
  expect(ledger.rows).toHaveLength(ledger.eventCount);
  expect(ledger.eventCount).toBe(1001);
  expect(ledger.rows.reduce((sum, row) => sum + (row.netAmount ?? 0), 0)).toBe(
    ledger.revenue
  );
});

it("restores opening costs, margin, meter withdrawals and staff attendance from one backup", async () => {
  const physical = await t.db.select().from(tankWithdrawals);
  const bases = await t.db.select().from(fuelCostOpenings);
  expect(physical.length).toBeGreaterThan(0);
  expect(bases.length).toBeGreaterThan(0);
  const [staff] = await t.db.select().from(staffUsers).limit(1);
  const [session] = await t.db
    .insert(attendanceSessions)
    .values({
      branchId: 1,
      staffId: staff.id,
      workDate: "2025-01-15",
      clockInMethod: "manual",
    })
    .returning();
  const [event] = await t.db
    .insert(attendanceEvents)
    .values({
      branchId: 1,
      staffId: staff.id,
      sessionId: session.id,
      method: "manual",
      eventType: "clock_in",
      idempotencyKey: "audit-backup-clock-in",
    })
    .returning();

  const backup = await createPortableDatabaseBackup();
  await t.db.delete(tankWithdrawals);
  await t.db.delete(fuelCostOpenings);
  await t.db.delete(attendanceSessions);
  expect((await restorePortableDatabaseBackup(backup)).legacyBackup).toBe(
    false
  );
  expect(await t.db.select().from(fuelCostOpenings)).toEqual(bases);
  expect(await t.db.select().from(tankWithdrawals)).toEqual(
    expect.arrayContaining(physical)
  );
  expect(await t.db.select().from(attendanceSessions)).toContainEqual(session);
  expect(await t.db.select().from(attendanceEvents)).toContainEqual(event);
  const report = await t
    .caller("manager")
    .fuelCosting.report({ from: "2025-01-01", to: "2025-01-31" });
  const diesel = await product("DB7");
  expect(
    report.items.find(item => item.id === diesel.id)?.ledger
  ).toMatchObject({
    revenue: 40040,
    costOfSales: 30030,
    grossProfit: 10010,
  });

  const envelope = JSON.parse(
    gunzipSync(Buffer.from(backup.contentBase64, "base64")).toString()
  );
  const originalTables = envelope.payload.tables as {
    name: string;
    rowCount: number;
  }[];
  function editedBackup(version: number, omit: string[]) {
    const tables = originalTables.filter(table => !omit.includes(table.name));
    const payload = {
      ...envelope.payload,
      tables,
      totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
    };
    const checksum = {
      algorithm: "SHA-256",
      value: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    };
    return {
      fileName: backup.fileName,
      contentBase64: gzipSync(
        JSON.stringify({ ...envelope, payload, version, checksum })
      ).toString("base64"),
    };
  }

  await expect(
    restorePortableDatabaseBackup(editedBackup(2, ["fuel_cost_openings"]))
  ).rejects.toThrow("ชุดตาราง");
  expect(await t.db.select().from(fuelCostOpenings)).toEqual(bases);

  const missing = [
    "fuel_cost_openings",
    "attendance_sessions",
    "attendance_events",
  ];
  expect(
    (await restorePortableDatabaseBackup(editedBackup(1, missing))).legacyBackup
  ).toBe(true);
  expect(await t.db.select().from(tankWithdrawals)).toEqual(
    expect.arrayContaining(physical)
  );
  expect(await t.db.select().from(fuelCostOpenings)).toHaveLength(0);
  expect(
    (
      await restorePortableDatabaseBackup(
        editedBackup(1, [...missing, "tank_withdrawals"])
      )
    ).legacyBackup
  ).toBe(true);
  const estimated = await t.db.select().from(tankWithdrawals);
  expect(estimated).toHaveLength(physical.length);
  expect(estimated.map(r => r.liters).sort()).toEqual(
    physical.map(r => r.liters).sort()
  );
});

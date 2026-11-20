import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { fuelTanks, products, sales, saleItems, tankRefills } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;
let productId: number;
let tankId: number;
beforeAll(async () => {
  t = await setupTestDb();
  const product = await t.db.query.products.findFirst({
    where: eq(products.code, "GSH95"),
  });
  productId = product!.id;
  tankId = (await t.db.query.fuelTanks.findFirst({
    where: eq(fuelTanks.productId, productId),
  }))!.id;
});
afterAll(() => t.cleanup());

describe("fuel costing APIs", () => {
  it("requires a manager, checks the branch and rejects invalid report dates", async () => {
    await expect(t.caller("cashier").fuelCosting.openings()).rejects.toThrow(
      "สิทธิ์"
    );
    await expect(
      t
        .caller("cashier")
        .fuelCosting.report({ from: "2026-01-01", to: "2026-01-31" })
    ).rejects.toThrow("สิทธิ์");
    await expect(
      t.caller("manager").fuelCosting.setOpening({
        productId: 999999,
        effectiveAt: new Date("2026-01-01"),
        liters: 1,
        unitCost: 30,
        note: "test",
      })
    ).rejects.toThrow("ไม่พบ");
    await expect(
      t
        .caller("manager")
        .fuelCosting.report({ from: "2026-02-30", to: "2026-03-01" })
    ).rejects.toThrow();
  });
  it("saves an immutable opening and uses invoice amounts, discounts and VAT", async () => {
    await t.caller("manager").fuelCosting.setOpening({
      productId,
      effectiveAt: new Date("2026-01-01T00:00:00+07:00"),
      liters: 2000,
      unitCost: 30,
      note: "ตรวจใบซื้อแล้ว",
    });
    await expect(
      t.caller("manager").fuelCosting.setOpening({
        productId,
        effectiveAt: new Date("2026-01-01"),
        liters: 1,
        unitCost: 1,
        note: "duplicate",
      })
    ).rejects.toThrow("แล้ว");
    await t.db.insert(tankRefills).values({
      tankId,
      branchId: 1,
      liters: 3000,
      costPerLiter: 34.24,
      netCostAmount: 96000,
      createdAt: new Date("2026-01-02T10:00:00+07:00"),
    });
    const [sale] = await t.db
      .insert(sales)
      .values({
        branchId: 1,
        receiptNo: "COST-1",
        subtotal: 36380,
        discount: 107,
        total: 36273,
        vatRate: 7,
        vatAmount: 2373,
        createdAt: new Date("2026-01-03T10:00:00+07:00"),
      })
      .returning();
    await t.db.insert(saleItems).values({
      branchId: 1,
      saleId: sale.id,
      productId,
      productCategory: "fuel",
      name: "GSH95",
      qty: 1000,
      unit: "ลิตร",
      unitPrice: 36.38,
      amount: 36380,
    });
    const r = await t
      .caller("manager")
      .fuelCosting.report({ from: "2026-01-01", to: "2026-01-31" });
    const ledger = r.items.find(item => item.id === productId)!.ledger!;
    expect(ledger.complete).toBe(true);
    expect(ledger.revenue).toBe(33900);
    expect(ledger.costOfSales).toBe(31200);
    expect(ledger.grossProfit).toBe(2700);
    await t.db
      .update(products)
      .set({ cost: 999, price: 999 })
      .where(eq(products.id, productId));
    const again = await t
      .caller("manager")
      .fuelCosting.report({ from: "2026-01-01", to: "2026-01-31" });
    expect(
      again.items.find(item => item.id === productId)!.ledger!.grossProfit
    ).toBe(2700);
    expect(r.items.find(item => item.id !== productId)?.ledger).toBeNull();
  });
  it("snapshots new acquisition cost including freight, discounts and recoverable VAT", async () => {
    await t.caller("manager").catalog.refillTank({
      tankId,
      liters: 10,
      costPerLiter: 32.1,
      freight: 10.7,
      purchaseDiscount: 10.7,
      costIncludesVat: true,
      purchaseVatRate: 7,
    });
    const row = await t.db.query.tankRefills.findFirst({
      where: and(eq(tankRefills.tankId, tankId), eq(tankRefills.liters, 10)),
    });
    expect(row?.netCostAmount).toBe(300);
  });
  it("requires confirmation for legacy receipts and prevents overwriting the confirmed value", async () => {
    const [receipt] = await t.db
      .insert(tankRefills)
      .values({ branchId: 1, tankId, liters: 20, costPerLiter: 32.1 })
      .returning();
    expect(
      (await t.caller("manager").fuelCosting.unconfirmedReceipts()).some(
        r => r.id === receipt.id
      )
    ).toBe(true);
    await t.caller("manager").fuelCosting.confirmReceiptCost({
      id: receipt.id,
      netAmount: 600,
      note: "ยืนยันใบซื้อ",
    });
    await expect(
      t.caller("manager").fuelCosting.confirmReceiptCost({
        id: receipt.id,
        netAmount: 50,
        note: "overwrite",
      })
    ).rejects.toThrow("แล้ว");
    await expect(
      t.caller("cashier").fuelCosting.confirmReceiptCost({
        id: receipt.id,
        netAmount: 50,
        note: "cashier",
      })
    ).rejects.toThrow("สิทธิ์");
  });
});

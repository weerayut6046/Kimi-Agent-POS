import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, saleItems, sales, shifts } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { attachShiftCashMeter, shiftFuelSalesTotals } from "./cash";

// เทสต์การคำนวณเงินสดเทียบยอด P บนฐานข้อมูลชั่วคราว (migrate + seed)
let t: TestDb;
const r2 = (value: number) => Math.round(value * 100) / 100;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

async function addSale(opts: {
  receiptNo: string;
  shiftId: number;
  paymentMethod?: "cash" | "qr" | "card" | "credit";
  status?: "completed" | "voided";
  discount?: number;
  items: Array<{ productId: number; qty: number; unitPrice: number }>;
}) {
  const items = opts.items.map(it => ({
    ...it,
    amount: r2(it.qty * it.unitPrice),
  }));
  const subtotal = r2(items.reduce((s, it) => s + it.amount, 0));
  const discount = opts.discount ?? 0;
  const [sale] = await t.db
    .insert(sales)
    .values({
      receiptNo: opts.receiptNo,
      shiftId: opts.shiftId,
      paymentMethod: opts.paymentMethod ?? "cash",
      status: opts.status ?? "completed",
      subtotal,
      discount,
      total: r2(subtotal - discount),
    })
    .returning({ id: sales.id });
  await t.db.insert(saleItems).values(
    items.map(it => ({
      saleId: sale.id,
      productId: it.productId,
      name: `สินค้า #${it.productId}`,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    }))
  );
}

describe("เงินสดเทียบยอด P", () => {
  let shiftA: number; // กะหลักที่มีบิล
  let shiftB: number; // กะอื่น (ห้ามถูกนับรวม)

  beforeAll(async () => {
    const fuel = await t.db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    const water = await t.db.query.products.findFirst({
      where: eq(products.code, "WATER"),
    });
    const [a] = await t.db
      .insert(shifts)
      .values({ staffName: "กะ A", status: "closed" })
      .returning({ id: shifts.id });
    const [b] = await t.db
      .insert(shifts)
      .values({ staffName: "กะ B", status: "closed" })
      .returning({ id: shifts.id });
    shiftA = a.id;
    shiftB = b.id;

    // บิลเงินสด น้ำมันล้วน 1,000
    await addSale({
      receiptNo: "CASH-P-1",
      shiftId: shiftA,
      items: [{ productId: fuel!.id, qty: 25, unitPrice: 40 }],
    });
    // บิลเครดิต น้ำมันล้วน 500
    await addSale({
      receiptNo: "CASH-P-2",
      shiftId: shiftA,
      paymentMethod: "credit",
      items: [{ productId: fuel!.id, qty: 12.5, unitPrice: 40 }],
    });
    // บิลเงินสดปน น้ำมัน 600 + น้ำ 400 ส่วนลด 100 → total 900
    // (สัดส่วนน้ำมัน 0.6 → นับเป็นยอดน้ำมัน 540)
    await addSale({
      receiptNo: "CASH-P-3",
      shiftId: shiftA,
      discount: 100,
      items: [
        { productId: fuel!.id, qty: 15, unitPrice: 40 },
        { productId: water!.id, qty: 20, unitPrice: 20 },
      ],
    });
    // บิลยกเลิก ต้องไม่ถูกนับ
    await addSale({
      receiptNo: "CASH-P-4",
      shiftId: shiftA,
      status: "voided",
      items: [{ productId: fuel!.id, qty: 5, unitPrice: 40 }],
    });
    // บิลของกะอื่น ต้องไม่ถูกนับรวมในกะ A
    await addSale({
      receiptNo: "CASH-P-5",
      shiftId: shiftB,
      items: [{ productId: fuel!.id, qty: 7.5, unitPrice: 40 }],
    });
  });

  it("shiftFuelSalesTotals รวมเฉพาะบิล completed ของกะนั้นและคิดสัดส่วนหลังส่วนลด", async () => {
    const map = await shiftFuelSalesTotals(t.db, 1, [shiftA, shiftB]);
    expect(map.get(shiftA)).toBe(2040); // 1000 + 500 + 540
    expect(map.get(shiftB)).toBe(300);
    expect(map.size).toBe(2);
  });

  it("attachShiftCashMeter คำนวณเงินสดควรมีเทียบ P และส่วนต่าง (ฝั่งนับได้รวมยอดโอน)", async () => {
    const rows = await attachShiftCashMeter(t.db, 1, [
      // expectedCash 2900 = ทอน 1000 + ขายเงินสด 1900 (บิล 1 และ 3)
      // ยอด P 2100 = น้ำมันที่ออกจริง (1000 + 500 เครดิต + 600 ในบิลปน)
      // นับได้ 2960 + โอน 500 → ต่าง = 3460 − 2960 = 500
      {
        id: shiftA,
        expectedCash: 2900,
        totalMoneyMeter: 2100,
        countedCash: 2960,
        transferAmount: 500,
      },
      // ไม่มี snapshot expectedCash → null
      {
        id: shiftB,
        expectedCash: null,
        totalMoneyMeter: 300,
        countedCash: 300,
        transferAmount: 50,
      },
      // ไม่มียอด P (กะเก่าก่อนระบบ P) → null
      {
        id: shiftB,
        expectedCash: 100,
        totalMoneyMeter: 0,
        countedCash: 100,
        transferAmount: 100,
      },
      // ไม่ได้นับเงินสด → ได้ cashExpectedP แต่ cashDiffP เป็น null
      {
        id: shiftA,
        expectedCash: 2900,
        totalMoneyMeter: 2100,
        countedCash: null,
        transferAmount: 500,
      },
      // ไม่มียอดโอน → เท่ากับสูตรเดิมที่ใช้เฉพาะยอดนับ
      {
        id: shiftA,
        expectedCash: 2900,
        totalMoneyMeter: 2100,
        countedCash: 2960,
        transferAmount: null,
      },
    ]);

    // ควรมีเทียบ P = 2900 + 2100 − 2040 = 2960 (ทอน 1000 + P 2100 − เครดิต 500 + น้ำเงินสด 360)
    expect(rows[0]).toMatchObject({ cashExpectedP: 2960, cashDiffP: 500 });
    expect(rows[1]).toMatchObject({ cashExpectedP: null, cashDiffP: null });
    expect(rows[2]).toMatchObject({ cashExpectedP: null, cashDiffP: null });
    expect(rows[3]).toMatchObject({ cashExpectedP: 2960, cashDiffP: null });
    expect(rows[4]).toMatchObject({ cashExpectedP: 2960, cashDiffP: 0 });
  });

  it("shiftHistory แนบ cashExpectedP/cashDiffP จาก snapshot ของกะ (รวมยอดโอน)", async () => {
    await t.db
      .update(shifts)
      .set({
        expectedCash: 2900,
        totalMoneyMeter: 2100,
        countedCash: 2960,
        transferAmount: 500,
      })
      .where(eq(shifts.id, shiftA));

    const hist = await t.caller().pos.shiftHistory();
    const row = hist.find(s => s.id === shiftA)!;
    expect(row.cashExpectedP).toBe(2960);
    expect(row.cashDiffP).toBe(500); // (2960 + 500) − 2960

    // กะที่ไม่มี snapshot expectedCash → เป็น null ทั้งคู่
    const legacy = hist.find(s => s.id === shiftB)!;
    expect(legacy.cashExpectedP).toBeNull();
    expect(legacy.cashDiffP).toBeNull();
  });
});

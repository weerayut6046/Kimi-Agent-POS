import { and, eq, inArray, sql } from "drizzle-orm";
import {
  debtPayments,
  expenses,
  products,
  saleItems,
  sales,
  type Shift,
} from "@db/schema";
import type { getDb } from "../queries/connection";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface ShiftCashSummary {
  openingFloat: number;
  cashSales: number; // ยอดขายเงินสดในกะ (บิล completed)
  cashDebtPayments: number; // รับชำระหนี้เงินสดในกะ
  expensesTotal: number; // ค่าใช้จ่ายในกะ
  expectedCash: number; // เงินสดที่ควรมีในลิ้นชัก
}

/**
 * สรุปเงินสดของกะ: เงินที่ควรมีในลิ้นชัก
 * = เงินทอนเริ่มกะ + ขายเงินสด + รับชำระหนี้เงินสด − ค่าใช้จ่าย
 */
export async function shiftCashSummary(
  db: ReturnType<typeof getDb>,
  shift: Pick<Shift, "id" | "branchId" | "openingFloat">
): Promise<ShiftCashSummary> {
  const [[saleRow], [debtRow], [expenseRow]] = await Promise.all([
    db
      .select({ sum: sql<number>`coalesce(sum(${sales.total}),0)` })
      .from(sales)
      .where(
        and(
          eq(sales.branchId, shift.branchId),
          eq(sales.shiftId, shift.id),
          eq(sales.status, "completed"),
          eq(sales.paymentMethod, "cash")
        )
      ),
    db
      .select({ sum: sql<number>`coalesce(sum(${debtPayments.amount}),0)` })
      .from(debtPayments)
      .where(
        and(
          eq(debtPayments.branchId, shift.branchId),
          eq(debtPayments.shiftId, shift.id),
          eq(debtPayments.method, "cash")
        )
      ),
    db
      .select({ sum: sql<number>`coalesce(sum(${expenses.amount}),0)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.branchId, shift.branchId),
          eq(expenses.shiftId, shift.id)
        )
      ),
  ]);

  const cashSales = r2(saleRow?.sum ?? 0);
  const cashDebtPayments = r2(debtRow?.sum ?? 0);
  const expensesTotal = r2(expenseRow?.sum ?? 0);
  return {
    openingFloat: shift.openingFloat,
    cashSales,
    cashDebtPayments,
    expensesTotal,
    expectedCash: r2(
      shift.openingFloat + cashSales + cashDebtPayments - expensesTotal
    ),
  };
}

/**
 * ยอดขายน้ำมัน (เฉพาะสินค้าหมวด fuel) จากบิล completed ของแต่ละกะ
 * คิดตามสัดส่วนมูลค่าน้ำมันในบิล (total × ยอดน้ำมัน/subtotal)
 * เพื่อให้สอดคล้องกับยอดบิลหลังหักส่วนลด (subtotal เป็น 0 ข้ามบิลนั้น)
 */
export async function shiftFuelSalesTotals(
  db: ReturnType<typeof getDb>,
  branchId: number,
  shiftIds: number[]
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (shiftIds.length === 0) return result;
  const saleRows = await db
    .select({
      id: sales.id,
      shiftId: sales.shiftId,
      subtotal: sales.subtotal,
      total: sales.total,
    })
    .from(sales)
    .where(
      and(
        eq(sales.branchId, branchId),
        inArray(sales.shiftId, shiftIds),
        eq(sales.status, "completed")
      )
    );
  if (saleRows.length === 0) return result;
  const fuelRows = await db
    .select({
      saleId: saleItems.saleId,
      fuel: sql<number>`coalesce(sum(${saleItems.amount}),0)`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(
      and(
        eq(saleItems.branchId, branchId),
        inArray(
          saleItems.saleId,
          saleRows.map(r => r.id)
        ),
        eq(products.category, "fuel")
      )
    )
    .groupBy(saleItems.saleId);
  const fuelBySale = new Map(fuelRows.map(r => [r.saleId, r.fuel]));
  for (const s of saleRows) {
    if (s.shiftId == null || s.subtotal <= 0) continue;
    const fuelAmount = fuelBySale.get(s.id) ?? 0;
    if (fuelAmount <= 0) continue;
    result.set(
      s.shiftId,
      (result.get(s.shiftId) ?? 0) + s.total * (fuelAmount / s.subtotal)
    );
  }
  for (const [id, value] of result) result.set(id, r2(value));
  return result;
}

export interface ShiftCashMeterColumns {
  /** เงินสดควรมีเมื่อใช้ยอด P แทนยอดขายน้ำมันใน POS (null ถ้าไม่มี expectedCash หรือยอด P) */
  cashExpectedP: number | null;
  /** (นับได้ + ยอดโอน) − cashExpectedP */
  cashDiffP: number | null;
}

export interface ShiftLubricantSaleItem {
  productId: number;
  name: string;
  unit: string;
  qty: number;
  amount: number;
}

export interface ShiftLubricantSalesSummary {
  lubricantAmount: number;
  lubricantItems: ShiftLubricantSaleItem[];
}

/**
 * รวมน้ำมันเครื่อง/2T ที่ขายผ่านบิล completed แยกตามกะและสินค้า
 * ใช้ทั้งรายการที่ขายจาก POS และรายการสรุปที่บันทึกเพิ่มตอนปิดกะ
 */
export async function shiftLubricantSalesSummaries(
  db: ReturnType<typeof getDb>,
  branchId: number,
  shiftIds: number[]
): Promise<Map<number, ShiftLubricantSalesSummary>> {
  const result = new Map<number, ShiftLubricantSalesSummary>();
  if (shiftIds.length === 0) return result;

  const rows = await db
    .select({
      shiftId: sales.shiftId,
      productId: products.id,
      name: products.name,
      unit: products.unit,
      qty: sql<number>`coalesce(sum(${saleItems.qty}),0)`.mapWith(Number),
      amount: sql<number>`coalesce(sum(${saleItems.amount}),0)`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(
      and(
        eq(saleItems.branchId, branchId),
        eq(sales.branchId, branchId),
        inArray(sales.shiftId, shiftIds),
        eq(sales.status, "completed"),
        eq(products.category, "lubricant")
      )
    )
    .groupBy(sales.shiftId, products.id, products.name, products.unit);

  for (const row of rows) {
    if (row.shiftId == null) continue;
    const current = result.get(row.shiftId) ?? {
      lubricantAmount: 0,
      lubricantItems: [],
    };
    current.lubricantItems.push({
      productId: row.productId,
      name: row.name,
      unit: row.unit,
      qty: r3(row.qty),
      amount: r2(row.amount),
    });
    current.lubricantAmount = r2(current.lubricantAmount + row.amount);
    result.set(row.shiftId, current);
  }

  return result;
}

export async function attachShiftLubricantSales<T extends { id: number }>(
  db: ReturnType<typeof getDb>,
  branchId: number,
  rows: T[]
): Promise<Array<T & ShiftLubricantSalesSummary>> {
  const summaries = await shiftLubricantSalesSummaries(
    db,
    branchId,
    rows.map(row => row.id)
  );
  return rows.map(row => ({
    ...row,
    ...(summaries.get(row.id) ?? {
      lubricantAmount: 0,
      lubricantItems: [],
    }),
  }));
}

/**
 * แนบคอลัมน์เงินสดเทียบยอด P ให้แถวข้อมูลกะ
 * cashExpectedP = expectedCash + ยอด P − ยอดขายน้ำมันตามบิล POS
 * (แทนยอดขายน้ำมันใน POS ด้วยยอดจากมิเตอร์เงิน P เพื่อจับบิลที่ลืมเปิดใน POS)
 * ฝั่งนับได้รวมยอดเงินโอนตอนปิดกะด้วย (นับได้ + โอน)
 * คิดเฉพาะกะที่มี expectedCash และยอด P > 0 — กะเก่าก่อนระบบ P ได้ null
 */
export async function attachShiftCashMeter<
  T extends {
    id: number;
    expectedCash: number | null;
    totalMoneyMeter: number;
    countedCash: number | null;
    transferAmount: number | null;
  },
>(
  db: ReturnType<typeof getDb>,
  branchId: number,
  rows: T[]
): Promise<Array<T & ShiftCashMeterColumns>> {
  const eligible = rows.filter(
    r => r.expectedCash != null && r.totalMoneyMeter > 0
  );
  const fuelByShift = await shiftFuelSalesTotals(
    db,
    branchId,
    eligible.map(r => r.id)
  );
  return rows.map(r => {
    if (r.expectedCash == null || r.totalMoneyMeter <= 0) {
      return { ...r, cashExpectedP: null, cashDiffP: null };
    }
    const cashExpectedP = r2(
      r.expectedCash + r.totalMoneyMeter - (fuelByShift.get(r.id) ?? 0)
    );
    return {
      ...r,
      cashExpectedP,
      cashDiffP:
        r.countedCash != null
          ? r2(r.countedCash + (r.transferAmount ?? 0) - cashExpectedP)
          : null,
    };
  });
}

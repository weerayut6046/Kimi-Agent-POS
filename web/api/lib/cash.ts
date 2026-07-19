import { and, eq, sql } from "drizzle-orm";
import { debtPayments, expenses, sales, type Shift } from "@db/schema";
import type { getDb } from "../queries/connection";

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  shift: Pick<Shift, "id" | "openingFloat">,
): Promise<ShiftCashSummary> {
  const [saleRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${sales.total}),0)` })
    .from(sales)
    .where(
      and(
        eq(sales.shiftId, shift.id),
        eq(sales.status, "completed"),
        eq(sales.paymentMethod, "cash"),
      ),
    );
  const [debtRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${debtPayments.amount}),0)` })
    .from(debtPayments)
    .where(and(eq(debtPayments.shiftId, shift.id), eq(debtPayments.method, "cash")));
  const [expenseRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${expenses.amount}),0)` })
    .from(expenses)
    .where(eq(expenses.shiftId, shift.id));

  const cashSales = r2(saleRow?.sum ?? 0);
  const cashDebtPayments = r2(debtRow?.sum ?? 0);
  const expensesTotal = r2(expenseRow?.sum ?? 0);
  return {
    openingFloat: shift.openingFloat,
    cashSales,
    cashDebtPayments,
    expensesTotal,
    expectedCash: r2(shift.openingFloat + cashSales + cashDebtPayments - expensesTotal),
  };
}

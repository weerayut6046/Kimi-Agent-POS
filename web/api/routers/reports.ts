import { z } from "zod";
import { and, asc, desc, gte, inArray, lt, or, type SQLWrapper } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { dayRange } from "../lib/dates";
import { queryExpenses } from "./expenses";
import { debtPayments, saleItems, sales, shifts } from "@db/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

export const reportsRouter = createRouter({
  // รายงานปิดวัน (Z-report) ของวันที่ระบุ — ยอดขาย/วิธีชำระ/ลิตรน้ำมัน/กะ/ค่าใช้จ่าย/รับชำระหนี้
  daily: publicQuery
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD") }))
    .query(async ({ input }) => {
      const db = getDb();
      const { start, end } = dayRange(input.date);
      const inDay = (col: SQLWrapper) => and(gte(col, start), lt(col, end));

      // ---- บิลของวัน ----
      const saleRows = await db
        .select()
        .from(sales)
        .where(inDay(sales.createdAt))
        .orderBy(asc(sales.createdAt));
      const completed = saleRows.filter((s) => s.status === "completed");
      const voided = saleRows.filter((s) => s.status === "voided");

      const byMethod = Object.fromEntries(
        PAY_METHODS.map((m) => {
          const rows = completed.filter((s) => s.paymentMethod === m);
          return [m, { count: rows.length, total: r2(rows.reduce((s, r) => s + r.total, 0)) }];
        }),
      ) as Record<(typeof PAY_METHODS)[number], { count: number; total: number }>;

      // ---- ลิตรน้ำมัน (sale_items ของบิล completed เฉพาะสินค้าหมวด fuel) ----
      const fuelByName = new Map<string, number>();
      let totalLiters = 0;
      if (completed.length > 0) {
        const itemRows = await db
          .select()
          .from(saleItems)
          .where(inArray(saleItems.saleId, completed.map((s) => s.id)));
        const prodRows = await db.query.products.findMany();
        for (const it of itemRows) {
          const p = prodRows.find((pr) => pr.id === it.productId);
          if (p?.category !== "fuel") continue;
          fuelByName.set(it.name, r2((fuelByName.get(it.name) ?? 0) + it.qty));
          totalLiters = r2(totalLiters + it.qty);
        }
      }
      const fuelLiters = [...fuelByName.entries()].map(([name, liters]) => ({ name, liters }));

      // ---- กะที่เปิดหรือปิดในวันนั้น ----
      const shiftRows = await db
        .select()
        .from(shifts)
        .where(or(inDay(shifts.openedAt), and(gte(shifts.closedAt, start), lt(shifts.closedAt, end))))
        .orderBy(asc(shifts.openedAt));

      // ---- ค่าใช้จ่ายของวัน (logic เดียวกับ expenses.list) ----
      const expenseResult = await queryExpenses(db, { start, end });

      // ---- รับชำระหนี้ของวัน (แนบชื่อลูกค้า) ----
      const payRows = await db
        .select()
        .from(debtPayments)
        .where(inDay(debtPayments.createdAt))
        .orderBy(desc(debtPayments.createdAt));
      const custRows = await db.query.customers.findMany();
      const debtItems = payRows.map((p) => ({
        ...p,
        customerName: custRows.find((c) => c.id === p.customerId)?.name ?? "",
      }));
      const debtByMethod = Object.fromEntries(
        DEBT_METHODS.map((m) => [m, r2(payRows.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0))]),
      ) as Record<(typeof DEBT_METHODS)[number], number>;
      const debtTotal = r2(payRows.reduce((s, p) => s + p.amount, 0));

      return {
        date: input.date,
        totalSales: r2(completed.reduce((s, r) => s + r.total, 0)),
        billCount: completed.length,
        voidedCount: voided.length,
        voidedTotal: r2(voided.reduce((s, r) => s + r.total, 0)),
        discountTotal: r2(completed.reduce((s, r) => s + r.discount, 0)),
        vatTotal: r2(completed.reduce((s, r) => s + r.vatAmount, 0)),
        byMethod,
        fuelLiters,
        totalLiters,
        shifts: shiftRows,
        expenses: expenseResult,
        debtPayments: { items: debtItems, total: debtTotal, byMethod: debtByMethod },
        // เงินสดที่ควรมีในลิ้นชัก = ขายเงินสด + รับชำระหนี้เงินสด − ค่าใช้จ่าย
        expectedCash: r2(byMethod.cash.total + debtByMethod.cash - expenseResult.total),
      };
    }),
});

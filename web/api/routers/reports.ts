import { z } from "zod";
import { and, asc, desc, gte, inArray, lt, or, type SQLWrapper } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { dayRange } from "../lib/dates";
import { queryExpenses } from "./expenses";
import { debtPayments, saleItems, sales, shifts } from "@db/schema";
import {
  buildDailyWorkbook,
  buildRangeWorkbook,
  type DailyReportData,
  type FuelProfitRow,
} from "../lib/excelExport";

const r2 = (n: number) => Math.round(n * 100) / 100;

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD");

/** Date → "YYYY-MM-DD" แบบ local (ห้ามใช้ toISOString เพราะจะเป็น UTC) */
function toDateStr(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * รายงานปิดวัน (Z-report) ของวันที่ระบุ — ใช้ร่วมกันทั้งหน้าเว็บและส่งออก Excel
 * คืน bills + fuelProfit ด้วย (ข้อมูลต้นทุน) — procedure สาธารณะต้อง strip ออกก่อนส่ง
 */
export async function queryDailyReport(db: ReturnType<typeof getDb>, date: string): Promise<DailyReportData> {
  const { start, end } = dayRange(date);
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

  // ---- ลิตรน้ำมัน + กำไร (sale_items ของบิล completed เฉพาะสินค้าหมวด fuel) ----
  const fuelByName = new Map<string, { liters: number; revenue: number; costPerLiter: number }>();
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
      const acc = fuelByName.get(it.name) ?? { liters: 0, revenue: 0, costPerLiter: p.cost };
      acc.liters = r2(acc.liters + it.qty);
      acc.revenue = r2(acc.revenue + it.amount);
      fuelByName.set(it.name, acc);
      totalLiters = r2(totalLiters + it.qty);
    }
  }
  const fuelLiters = [...fuelByName.entries()].map(([name, v]) => ({ name, liters: v.liters }));
  // กำไรโดยประมาณจากต้นทุนสินค้าปัจจุบัน (cost = 0 คือยังไม่ได้ตั้งต้นทุน)
  const fuelProfit: FuelProfitRow[] = [...fuelByName.entries()].map(([name, v]) => ({
    name,
    liters: v.liters,
    revenue: v.revenue,
    costPerLiter: v.costPerLiter,
    profitPerLiter: v.liters > 0 ? r2(v.revenue / v.liters - v.costPerLiter) : 0,
    profitTotal: r2(v.revenue - v.costPerLiter * v.liters),
  }));

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
    date,
    totalSales: r2(completed.reduce((s, r) => s + r.total, 0)),
    billCount: completed.length,
    voidedCount: voided.length,
    voidedTotal: r2(voided.reduce((s, r) => s + r.total, 0)),
    discountTotal: r2(completed.reduce((s, r) => s + r.discount, 0)),
    vatTotal: r2(completed.reduce((s, r) => s + r.vatAmount, 0)),
    byMethod,
    fuelLiters,
    totalLiters,
    fuelProfit,
    shifts: shiftRows,
    expenses: expenseResult,
    debtPayments: { items: debtItems, total: debtTotal, byMethod: debtByMethod },
    // เงินสดที่ควรมีในลิ้นชัก = ขายเงินสด + รับชำระหนี้เงินสด − ค่าใช้จ่าย
    expectedCash: r2(byMethod.cash.total + debtByMethod.cash - expenseResult.total),
    bills: saleRows,
  };
}

export const reportsRouter = createRouter({
  // Z-report หน้าเว็บ — strip bills + fuelProfit (ข้อมูลต้นทุน) ออก เหลือเฉพาะยอดขาย
  daily: publicQuery.input(z.object({ date: dateSchema })).query(async ({ input }) => {
    const { bills: _bills, fuelProfit: _profit, ...pub } = await queryDailyReport(getDb(), input.date);
    return pub;
  }),

  // กำไรโดยประมาณต่อลิตรของวัน (มีข้อมูลต้นทุน — เฉพาะ admin/manager)
  fuelProfit: managerQuery.input(z.object({ date: dateSchema })).query(async ({ input }) => {
    const r = await queryDailyReport(getDb(), input.date);
    return { date: r.date, items: r.fuelProfit };
  }),

  // ส่งออก Z-report ของวันเป็น Excel (base64 — หน้าเว็บแปลงเป็นไฟล์ดาวน์โหลด)
  exportDailyExcel: managerQuery.input(z.object({ date: dateSchema })).query(async ({ input }) => {
    const daily = await queryDailyReport(getDb(), input.date);
    const buf = await buildDailyWorkbook(daily);
    return { fileName: `zreport-${input.date}.xlsx`, contentBase64: buf.toString("base64") };
  }),

  // ส่งออกยอดขายช่วงเวลาเป็น Excel (สูงสุด 92 วัน)
  exportRangeExcel: managerQuery
    .input(z.object({ from: dateSchema, to: dateSchema }))
    .query(async ({ input }) => {
      const { start } = dayRange(input.from);
      const { end } = dayRange(input.to); // end = ต้นวันถัดจาก to
      const nDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      if (nDays < 1) throw new Error("วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
      if (nDays > 92) throw new Error("ช่วงเวลาส่งออกยาวเกินไป (สูงสุด 92 วันต่อครั้ง)");

      const db = getDb();
      const days: DailyReportData[] = [];
      for (let d = start; d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        days.push(await queryDailyReport(db, toDateStr(d)));
      }

      // รวมกำไรน้ำมันทั้งช่วง (ต่อชนิดน้ำมัน)
      const acc = new Map<string, { liters: number; revenue: number; profitTotal: number; costPerLiter: number }>();
      for (const d of days) {
        for (const p of d.fuelProfit) {
          const a = acc.get(p.name) ?? { liters: 0, revenue: 0, profitTotal: 0, costPerLiter: p.costPerLiter };
          a.liters = r2(a.liters + p.liters);
          a.revenue = r2(a.revenue + p.revenue);
          a.profitTotal = r2(a.profitTotal + p.profitTotal);
          acc.set(p.name, a);
        }
      }
      const profit: FuelProfitRow[] = [...acc.entries()].map(([name, a]) => ({
        name,
        liters: a.liters,
        revenue: a.revenue,
        costPerLiter: a.costPerLiter,
        profitPerLiter: a.liters > 0 ? r2(a.profitTotal / a.liters) : 0,
        profitTotal: a.profitTotal,
      }));

      const buf = await buildRangeWorkbook({ from: input.from, to: input.to, days, profit });
      return {
        fileName: `sales-${input.from.replaceAll("-", "")}_${input.to.replaceAll("-", "")}.xlsx`,
        contentBase64: buf.toString("base64"),
      };
    }),
});

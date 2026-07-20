import { z } from "zod";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { outstandingOf } from "../lib/debt";
import { actorFromReq, logAudit } from "../lib/audit";
import { customers, sales, shifts, debtPayments } from "@db/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const creditRouter = createRouter({
  // สรุปยอดค้างชำระของลูกค้าทุกคน (เรียงยอดค้างมาก → น้อย)
  summary: publicQuery
    .input(z.object({ q: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const q = input?.q?.trim();
      const pattern = q ? `%${q}%` : null;
      const custRows = await db
        .select()
        .from(customers)
        .where(
          pattern
            ? or(
                like(customers.name, pattern),
                like(customers.phone, pattern),
                like(customers.taxId, pattern)
              )
            : undefined
        );
      const rows = [];
      for (const c of custRows) {
        rows.push({ ...c, outstanding: await outstandingOf(db, c.id) });
      }
      return rows.sort((a, b) => b.outstanding - a.outstanding);
    }),

  // รายละเอียดลูกค้าเครดิต: บิลเครดิตค้าง + ประวัติชำระ
  detail: publicQuery
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!customer) throw new Error("ไม่พบลูกค้า");
      const creditSales = await db
        .select({
          id: sales.id,
          receiptNo: sales.receiptNo,
          total: sales.total,
          staffName: sales.staffName,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .where(
          and(
            eq(sales.customerId, customer.id),
            eq(sales.paymentMethod, "credit"),
            eq(sales.status, "completed")
          )
        )
        .orderBy(asc(sales.createdAt));
      const payments = await db
        .select()
        .from(debtPayments)
        .where(eq(debtPayments.customerId, customer.id))
        .orderBy(desc(debtPayments.createdAt));
      return {
        customer,
        outstanding: await outstandingOf(db, customer.id),
        creditSales,
        payments,
      };
    }),

  // รับชำระหนี้ (ผูกกับลูกค้า ไม่ผูกกับบิล — รับบางส่วนได้) — สงวนสิทธิ์ admin/manager
  receivePayment: managerQuery
    .input(
      z.object({
        customerId: z.number(),
        amount: z.number().positive(),
        method: z.enum(["cash", "qr", "transfer"]).default("cash"),
        staffName: z.string().default(""),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!customer) throw new Error("ไม่พบลูกค้า");
      const amount = r2(input.amount);
      if (amount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0");
      const outstanding = await outstandingOf(db, customer.id);
      if (amount > outstanding) throw new Error("ยอดชำระมากกว่ายอดค้างชำระ");

      // ถ้ามีกะเปิดอยู่ให้ผูก shiftId อัตโนมัติ (เหมือนค่าใช้จ่าย) — ต้องหาก่อนเข้า tx
      const openShift = await db.query.shifts.findFirst({
        where: eq(shifts.status, "open"),
      });

      // transaction ของ better-sqlite3 เป็น synchronous — ห้าม await ข้างใน
      const paymentId = db.transaction(tx => {
        const paymentNo = nextDocNo(tx, "debt_payment");
        const [{ id }] = tx
          .insert(debtPayments)
          .values({
            paymentNo,
            customerId: customer.id,
            amount,
            method: input.method,
            shiftId: openShift?.id ?? null,
            staffName: input.staffName,
            note: input.note,
          })
          .returning({ id: debtPayments.id })
          .all();
        return id;
      });
      const payment = await db.query.debtPayments.findFirst({
        where: eq(debtPayments.id, paymentId),
      });
      logAudit({
        action: "receive_debt_payment",
        ...actorFromReq(ctx.req),
        detail: `รับชำระหนี้ ${payment!.paymentNo} จาก ${customer.name} ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${input.method})`,
        refType: "debt_payment",
        refId: paymentId,
      });
      return payment;
    }),

  // ลบรายการชำระ (กรณีคีย์ผิด) — สงวนสิทธิ์ admin/manager
  removePayment: managerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = await db.query.debtPayments.findFirst({
        where: eq(debtPayments.id, input.id),
      });
      if (!existing) throw new Error("ไม่พบรายการชำระ");
      await db.delete(debtPayments).where(eq(debtPayments.id, input.id));
      logAudit({
        action: "remove_debt_payment",
        ...actorFromReq(ctx.req),
        detail: `ลบการชำระหนี้ ${existing.paymentNo} ยอด ${existing.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        refType: "debt_payment",
        refId: input.id,
      });
      return { ok: true };
    }),
});

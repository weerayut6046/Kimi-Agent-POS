import { z } from "zod";
import { and, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { dayRange } from "../lib/dates";
import { actorFromReq, logAudit } from "../lib/audit";
import { expenses, shifts } from "@db/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ดึงรายการค่าใช้จ่ายตามช่วงเวลา/คำค้น — ใช้ร่วมกันระหว่าง expenses.list และ reports.daily
 * คืน items (เรียงใหม่ → เก่า) + total (ผลรวม amount ของ items ที่คืน)
 */
export async function queryExpenses(
  db: ReturnType<typeof getDb>,
  opts: { start?: Date; end?: Date; q?: string },
) {
  const conds = [];
  if (opts.start) conds.push(gte(expenses.createdAt, opts.start));
  if (opts.end) conds.push(lt(expenses.createdAt, opts.end));
  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conds.push(
      or(like(expenses.title, pattern), like(expenses.category, pattern), like(expenses.note, pattern)),
    );
  }
  const items = await db
    .select()
    .from(expenses)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(expenses.createdAt));
  return { items, total: r2(items.reduce((s, e) => s + e.amount, 0)) };
}

export const expensesRouter = createRouter({
  // รายการค่าใช้จ่าย — ถ้าส่ง date ("YYYY-MM-DD") จะเฉพาะวันนั้น (local day)
  list: publicQuery
    .input(z.object({ date: z.string().optional(), q: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const range = input?.date ? dayRange(input.date) : {};
      return queryExpenses(getDb(), { ...range, q: input?.q });
    }),

  // บันทึกค่าใช้จ่าย — ถ้ามีกะเปิดอยู่จะผูก shiftId อัตโนมัติ (ทุกสิทธิ์บันทึกได้)
  create: publicQuery
    .input(
      z.object({
        title: z.string().min(1, "กรุณาระบุรายการ"),
        category: z.string().default(""),
        amount: z.number().positive("จำนวนเงินต้องมากกว่า 0"),
        note: z.string().optional(),
        staffName: z.string().default(""),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const openShift = await db.query.shifts.findFirst({ where: eq(shifts.status, "open") });
      const [{ id }] = await db
        .insert(expenses)
        .values({
          title: input.title,
          category: input.category,
          amount: r2(input.amount),
          shiftId: openShift?.id ?? null,
          staffName: input.staffName,
          note: input.note,
        })
        .returning({ id: expenses.id });
      logAudit({
        action: "create_expense",
        ...actorFromReq(ctx.req),
        detail: `ค่าใช้จ่าย "${input.title}" ${r2(input.amount).toFixed(2)} บาท`,
        refType: "expense",
        refId: id,
      });
      return db.query.expenses.findFirst({ where: eq(expenses.id, id) });
    }),

  // แก้ไขค่าใช้จ่าย (admin/manager) — อัปเดตเฉพาะ field ที่ส่งมา
  update: managerQuery
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const db = getDb();
      const existing = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
      if (!existing) throw new Error("ไม่พบรายการค่าใช้จ่าย");
      if (patch.amount !== undefined) patch.amount = r2(patch.amount);
      await db.update(expenses).set(patch).where(eq(expenses.id, id));
      const updated = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
      logAudit({
        action: "update_expense",
        ...actorFromReq(ctx.req),
        detail: `แก้ค่าใช้จ่าย "${updated!.title}" ${updated!.amount.toFixed(2)} บาท (เดิม "${existing.title}" ${existing.amount.toFixed(2)} บาท)`,
        refType: "expense",
        refId: id,
      });
      return updated;
    }),

  // ลบค่าใช้จ่าย (admin/manager)
  remove: managerQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const existing = await db.query.expenses.findFirst({ where: eq(expenses.id, input.id) });
    if (!existing) throw new Error("ไม่พบรายการค่าใช้จ่าย");
    await db.delete(expenses).where(eq(expenses.id, input.id));
    logAudit({
      action: "remove_expense",
      ...actorFromReq(ctx.req),
      detail: `ลบค่าใช้จ่าย "${existing.title}" ${existing.amount.toFixed(2)} บาท`,
      refType: "expense",
      refId: input.id,
    });
    return { ok: true };
  }),
});

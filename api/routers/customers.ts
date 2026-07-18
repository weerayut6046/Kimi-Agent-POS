import { z } from "zod";
import { desc, eq, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { customers } from "@db/schema";

const customerInput = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อลูกค้า"),
  taxId: z.string().default(""),
  branch: z.string().default(""),
  address: z.string().default(""),
  phone: z.string().default(""),
  vehiclePlate: z.string().default(""),
});

export const customersRouter = createRouter({
  // ค้นหา/แสดงรายการลูกค้า (ทุกสิทธิ์ใช้ได้ — ใช้ตอนออกใบกำกับภาษี)
  list: publicQuery
    .input(z.object({ q: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      const q = input?.q?.trim();
      const pattern = q ? `%${q}%` : null;
      return getDb()
        .select()
        .from(customers)
        .where(
          pattern
            ? or(
                like(customers.name, pattern),
                like(customers.taxId, pattern),
                like(customers.phone, pattern),
                like(customers.vehiclePlate, pattern),
              )
            : undefined,
        )
        .orderBy(desc(customers.createdAt))
        .limit(input?.limit ?? 100);
    }),

  create: managerQuery.input(customerInput).mutation(async ({ input }) => {
    const db = getDb();
    if (input.taxId) {
      const dup = await db.query.customers.findFirst({ where: eq(customers.taxId, input.taxId) });
      if (dup) throw new Error(`มีลูกค้าที่ใช้เลขผู้เสียภาษีนี้แล้ว (${dup.name})`);
    }
    const [{ id }] = await db.insert(customers).values(input).$returningId();
    return db.query.customers.findFirst({ where: eq(customers.id, id) });
  }),

  update: managerQuery.input(customerInput.partial().extend({ id: z.number() })).mutation(async ({ input }) => {
    const { id, ...patch } = input;
    const db = getDb();
    const existing = await db.query.customers.findFirst({ where: eq(customers.id, id) });
    if (!existing) throw new Error("ไม่พบลูกค้า");
    if (patch.taxId && patch.taxId !== existing.taxId) {
      const dup = await db.query.customers.findFirst({ where: eq(customers.taxId, patch.taxId) });
      if (dup && dup.id !== id) throw new Error(`มีลูกค้าที่ใช้เลขผู้เสียภาษีนี้แล้ว (${dup.name})`);
    }
    await db.update(customers).set(patch).where(eq(customers.id, id));
    return db.query.customers.findFirst({ where: eq(customers.id, id) });
  }),

  remove: managerQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(customers).where(eq(customers.id, input.id));
    return { ok: true };
  }),
});

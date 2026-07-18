import { z } from "zod";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { auditLogs } from "@db/schema";

export const auditRouter = createRouter({
  // รายการ audit log (admin เท่านั้น) — เรียงใหม่ → เก่า กรองตาม action และคำค้น (ผู้ทำ/รายละเอียด)
  list: adminQuery
    .input(
      z
        .object({
          q: z.string().optional(),
          action: z.string().optional(),
          limit: z.number().int().positive().max(1000).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.action) conds.push(eq(auditLogs.action, input.action));
      const q = input?.q?.trim();
      if (q) {
        const pattern = `%${q}%`;
        conds.push(or(like(auditLogs.actorName, pattern), like(auditLogs.detail, pattern)));
      }
      const rows = await db
        .select()
        .from(auditLogs)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(input?.limit ?? 200);
      // distinct action ทั้งหมด — ใช้เติม dropdown ตัวกรองฝั่ง UI
      const actionRows = await db
        .selectDistinct({ action: auditLogs.action })
        .from(auditLogs)
        .orderBy(sql`${auditLogs.action}`);
      return { rows, actions: actionRows.map((r) => r.action) };
    }),
});

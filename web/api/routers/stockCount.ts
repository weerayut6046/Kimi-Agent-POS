import { z } from "zod";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { products, stockCountItems, stockCountSessions } from "@db/schema";

const countScope = z.enum(["all", "lubricant", "other"]);

function itemWithDifference(item: typeof stockCountItems.$inferSelect) {
  return {
    ...item,
    difference:
      item.countedQty == null ? null : item.countedQty - item.expectedQty,
  };
}

function summarizeItems(items: (typeof stockCountItems.$inferSelect)[]) {
  const counted = items.filter(item => item.countedQty != null);
  return {
    totalItems: items.length,
    countedItems: counted.length,
    remainingItems: items.length - counted.length,
    varianceItems: counted.filter(item => item.countedQty !== item.expectedQty)
      .length,
    totalDifference: counted.reduce(
      (sum, item) => sum + (item.countedQty! - item.expectedQty),
      0
    ),
  };
}

function defaultSessionName(): string {
  const date = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
  return `รอบนับสต๊อก ${date}`;
}

export const stockCountRouter = createRouter({
  listSessions: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const sessions = await db
      .select()
      .from(stockCountSessions)
      .where(eq(stockCountSessions.branchId, ctx.staff.branchId))
      .orderBy(desc(stockCountSessions.startedAt), desc(stockCountSessions.id))
      .limit(30);

    if (sessions.length === 0) return [];
    const items = await db
      .select()
      .from(stockCountItems)
      .where(
        and(
          eq(stockCountItems.branchId, ctx.staff.branchId),
          inArray(
            stockCountItems.sessionId,
            sessions.map(session => session.id)
          )
        )
      );

    return sessions.map(session => ({
      ...session,
      summary: summarizeItems(
        items.filter(item => item.sessionId === session.id)
      ),
    }));
  }),

  getSession: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [session] = await db
        .select()
        .from(stockCountSessions)
        .where(
          and(
            eq(stockCountSessions.id, input.id),
            eq(stockCountSessions.branchId, ctx.staff.branchId)
          )
        )
        .limit(1);
      if (!session) throw new Error("ไม่พบรอบนับสต๊อกของสาขานี้");

      const items = await db
        .select()
        .from(stockCountItems)
        .where(
          and(
            eq(stockCountItems.sessionId, session.id),
            eq(stockCountItems.branchId, ctx.staff.branchId)
          )
        )
        .orderBy(
          asc(stockCountItems.category),
          asc(stockCountItems.productCode),
          asc(stockCountItems.id)
        );

      return {
        ...session,
        items: items.map(itemWithDifference),
        summary: summarizeItems(items),
      };
    }),

  createSession: managerQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        scope: countScope.default("all"),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const sessionId = await db.transaction(async tx => {
        const [openSession] = await tx
          .select({ id: stockCountSessions.id })
          .from(stockCountSessions)
          .where(
            and(
              eq(stockCountSessions.branchId, ctx.staff.branchId),
              eq(stockCountSessions.status, "counting")
            )
          )
          .limit(1);
        if (openSession) {
          throw new Error(
            `มีรอบนับ #${openSession.id} ที่กำลังดำเนินการอยู่ กรุณาใช้รอบเดิมหรือยกเลิกก่อน`
          );
        }

        const categoryCondition =
          input.scope === "all"
            ? ne(products.category, "fuel")
            : eq(products.category, input.scope);
        const productRows = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.branchId, ctx.staff.branchId),
              eq(products.active, true),
              categoryCondition
            )
          )
          .orderBy(asc(products.category), asc(products.code));
        if (productRows.length === 0) {
          throw new Error("ไม่มีสินค้าในหมวดที่เลือกสำหรับเริ่มนับ");
        }

        const [session] = await tx
          .insert(stockCountSessions)
          .values({
            branchId: ctx.staff.branchId,
            name: input.name ?? defaultSessionName(),
            scope: input.scope,
            startedById: ctx.staff.id,
            startedByName: ctx.staff.name,
            note: input.note || null,
          })
          .returning({ id: stockCountSessions.id });

        await tx.insert(stockCountItems).values(
          productRows.map(product => ({
            branchId: ctx.staff.branchId,
            sessionId: session.id,
            productId: product.id,
            productCode: product.code,
            productName: product.name,
            category: product.category as "lubricant" | "other",
            unit: product.unit,
            expectedQty: product.stockQty,
          }))
        );
        return session.id;
      });

      logAudit({
        action: "stock_count.create",
        ...actorFromReq(ctx.req),
        detail: `เริ่มรอบนับสต๊อก #${sessionId} (${input.scope})`,
        refType: "stock_count_session",
        refId: sessionId,
      });
      return { ok: true, id: sessionId };
    }),

  saveItemCount: publicQuery
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        countedQty: z.number().nonnegative().max(999_999_999),
        note: z.string().trim().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const item = await db.transaction(async tx => {
        const [session] = await tx
          .select()
          .from(stockCountSessions)
          .where(
            and(
              eq(stockCountSessions.id, input.sessionId),
              eq(stockCountSessions.branchId, ctx.staff.branchId)
            )
          )
          .for("update");
        if (!session) throw new Error("ไม่พบรอบนับสต๊อกของสาขานี้");
        if (session.status !== "counting") {
          throw new Error("รอบนับนี้ปิดแล้ว ไม่สามารถแก้ไขจำนวนได้");
        }

        const [existing] = await tx
          .select()
          .from(stockCountItems)
          .where(
            and(
              eq(stockCountItems.id, input.itemId),
              eq(stockCountItems.sessionId, session.id),
              eq(stockCountItems.branchId, ctx.staff.branchId)
            )
          )
          .limit(1);
        if (!existing) throw new Error("ไม่พบสินค้าในรอบนับนี้");

        const [updated] = await tx
          .update(stockCountItems)
          .set({
            countedQty: input.countedQty,
            countedById: ctx.staff.id,
            countedByName: ctx.staff.name,
            countedAt: new Date(),
            note: input.note || null,
            updatedAt: new Date(),
          })
          .where(eq(stockCountItems.id, existing.id))
          .returning();
        await tx
          .update(stockCountSessions)
          .set({ updatedAt: new Date() })
          .where(eq(stockCountSessions.id, session.id));
        return updated;
      });

      return { ok: true, item: itemWithDifference(item) };
    }),

  completeSession: managerQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const result = await db.transaction(async tx => {
        const [session] = await tx
          .select()
          .from(stockCountSessions)
          .where(
            and(
              eq(stockCountSessions.id, input.id),
              eq(stockCountSessions.branchId, ctx.staff.branchId)
            )
          )
          .for("update");
        if (!session) throw new Error("ไม่พบรอบนับสต๊อกของสาขานี้");
        if (session.status !== "counting") {
          throw new Error("รอบนับนี้ถูกปิดไปแล้ว");
        }

        const items = await tx
          .select()
          .from(stockCountItems)
          .where(
            and(
              eq(stockCountItems.sessionId, session.id),
              eq(stockCountItems.branchId, ctx.staff.branchId)
            )
          );
        if (items.length === 0) throw new Error("รอบนับนี้ไม่มีสินค้า");
        const remaining = items.filter(item => item.countedQty == null);
        if (remaining.length > 0) {
          throw new Error(`ยังนับสินค้าไม่ครบอีก ${remaining.length} รายการ`);
        }

        for (const item of items) {
          if (!item.productId) {
            throw new Error(
              `สินค้า ${item.productCode} ถูกลบหลังเริ่มนับ กรุณายกเลิกรอบนี้และเริ่มใหม่`
            );
          }
          const updatedProducts = await tx
            .update(products)
            .set({ stockQty: item.countedQty! })
            .where(
              and(
                eq(products.id, item.productId),
                eq(products.branchId, ctx.staff.branchId),
                ne(products.category, "fuel")
              )
            )
            .returning({ id: products.id });
          if (updatedProducts.length !== 1) {
            throw new Error(
              `ไม่สามารถปรับยอดสินค้า ${item.productCode} ได้ กรุณาตรวจสอบข้อมูลสินค้า`
            );
          }
        }

        const completedAt = new Date();
        await tx
          .update(stockCountSessions)
          .set({
            status: "completed",
            completedById: ctx.staff.id,
            completedByName: ctx.staff.name,
            completedAt,
            updatedAt: completedAt,
          })
          .where(eq(stockCountSessions.id, session.id));
        return summarizeItems(items);
      });

      logAudit({
        action: "stock_count.complete",
        ...actorFromReq(ctx.req),
        detail: `ยืนยันรอบนับสต๊อก #${input.id}: ต่าง ${result.totalDifference} หน่วย (${result.varianceItems} รายการ)`,
        refType: "stock_count_session",
        refId: input.id,
      });
      return { ok: true, summary: result };
    }),

  cancelSession: managerQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.transaction(async tx => {
        const [session] = await tx
          .select()
          .from(stockCountSessions)
          .where(
            and(
              eq(stockCountSessions.id, input.id),
              eq(stockCountSessions.branchId, ctx.staff.branchId)
            )
          )
          .for("update");
        if (!session) throw new Error("ไม่พบรอบนับสต๊อกของสาขานี้");
        if (session.status !== "counting") {
          throw new Error("ยกเลิกได้เฉพาะรอบที่กำลังนับ");
        }
        const cancelledAt = new Date();
        await tx
          .update(stockCountSessions)
          .set({
            status: "cancelled",
            completedById: ctx.staff.id,
            completedByName: ctx.staff.name,
            completedAt: cancelledAt,
            updatedAt: cancelledAt,
          })
          .where(eq(stockCountSessions.id, session.id));
      });

      logAudit({
        action: "stock_count.cancel",
        ...actorFromReq(ctx.req),
        detail: `ยกเลิกรอบนับสต๊อก #${input.id}`,
        refType: "stock_count_session",
        refId: input.id,
      });
      return { ok: true };
    }),
});

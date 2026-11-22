import { z } from "zod";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import {
  fuelCostOpenings,
  fuelTanks,
  products,
  saleItems,
  sales,
  tankRefills,
} from "@db/schema";
import {
  calculateFuelCostLedger,
  type FuelCostEvent,
} from "@contracts/fuelCosting";
import { actorFromReq, logAudit } from "../lib/audit";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const at = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value
    );
  }, "วันที่ไม่ถูกต้อง");
const range = z.object({ from: date, to: date }).refine(input => {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
  return days >= 0 && days <= 365;
}, "เลือกช่วงวันเรียงลำดับและยาวไม่เกิน 366 วัน");

export const fuelCostingRouter = createRouter({
  unconfirmedReceipts: managerQuery.query(({ ctx }) => {
    const branchId = ctx.staff.branchId;
    return getDb()
      .select({
        id: tankRefills.id,
        at: tankRefills.createdAt,
        liters: tankRefills.liters,
        price: tankRefills.costPerLiter,
        name: products.name,
      })
      .from(tankRefills)
      .innerJoin(
        fuelTanks,
        and(
          eq(fuelTanks.id, tankRefills.tankId),
          eq(fuelTanks.branchId, branchId)
        )
      )
      .innerJoin(
        products,
        and(
          eq(
            products.id,
            sql`coalesce(${tankRefills.costProductId}, ${fuelTanks.productId})`
          ),
          eq(products.branchId, branchId),
          eq(products.category, "fuel")
        )
      )
      .where(
        and(
          eq(tankRefills.branchId, branchId),
          isNull(tankRefills.netCostAmount)
        )
      )
      .orderBy(desc(tankRefills.createdAt), desc(tankRefills.id))
      .limit(100);
  }),

  confirmReceiptCost: managerQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        netAmount: z.number().finite().nonnegative().max(1e12),
        note: z.string().trim().min(1).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const branchId = ctx.staff.branchId,
        db = getDb();
      const [source] = await db
        .select({ productId: fuelTanks.productId })
        .from(tankRefills)
        .innerJoin(
          fuelTanks,
          and(
            eq(fuelTanks.id, tankRefills.tankId),
            eq(fuelTanks.branchId, branchId)
          )
        )
        .where(
          and(eq(tankRefills.id, input.id), eq(tankRefills.branchId, branchId))
        );
      if (!source) throw new Error("ไม่พบล็อตในสาขานี้");
      const [updated] = await db
        .update(tankRefills)
        .set({
          netCostAmount: input.netAmount,
          costProductId: source.productId,
        })
        .where(
          and(
            eq(tankRefills.id, input.id),
            eq(tankRefills.branchId, branchId),
            isNull(tankRefills.netCostAmount)
          )
        )
        .returning({ id: tankRefills.id });
      if (!updated)
        throw new Error("ไม่พบล็อตที่รอยืนยันต้นทุน หรือยืนยันแล้ว");
      logAudit({
        action: "fuelCosting.confirmReceipt",
        ...actorFromReq(ctx.req),
        detail: `ยืนยันต้นทุนสุทธิล็อต #${input.id} ${input.netAmount} บาท — ${input.note}`,
        refType: "tank_refill",
        refId: input.id,
      });
      return { ok: true };
    }),

  openings: managerQuery.query(async ({ ctx }) => {
    const branchId = ctx.staff.branchId;
    return getDb()
      .select({
        productId: products.id,
        name: products.name,
        opening: fuelCostOpenings,
      })
      .from(products)
      .leftJoin(
        fuelCostOpenings,
        and(
          eq(fuelCostOpenings.branchId, branchId),
          eq(fuelCostOpenings.productId, products.id)
        )
      )
      .where(
        and(eq(products.branchId, branchId), eq(products.category, "fuel"))
      );
  }),

  setOpening: managerQuery
    .input(
      z.object({
        productId: z.number().int().positive(),
        effectiveAt: z.coerce
          .date()
          .refine(at => at <= new Date(), "วันที่ยกมาต้องไม่อยู่ในอนาคต"),
        liters: z.number().finite().nonnegative().max(1e9),
        unitCost: z.number().finite().nonnegative().max(1e6),
        note: z.string().trim().min(1, "ระบุที่มาของยอดยกมา").max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb(),
        branchId = ctx.staff.branchId;
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.branchId, branchId),
            eq(products.id, input.productId),
            eq(products.category, "fuel")
          )
        );
      if (!product) throw new Error("ไม่พบน้ำมันในสาขานี้");
      const [created] = await db
        .insert(fuelCostOpenings)
        .values({ ...input, branchId })
        .onConflictDoNothing()
        .returning({ id: fuelCostOpenings.id });
      if (!created) throw new Error("น้ำมันชนิดนี้บันทึกยอดยกมาแล้ว");
      logAudit({
        action: "fuelCosting.opening",
        ...actorFromReq(ctx.req),
        detail: `ยอดยกมาสินค้า #${input.productId} ${input.liters} ลิตร ต้นทุนสุทธิ ${input.unitCost} บาท/ลิตร ณ ${input.effectiveAt.toISOString()} — ${input.note}`,
        refType: "fuel_cost_opening",
        refId: created.id,
      });
      return { ok: true };
    }),

  report: managerQuery.input(range).query(async ({ input, ctx }) => {
    const db = getDb(),
      branchId = ctx.staff.branchId;
    const from = new Date(input.from + "T00:00:00+07:00");
    const to = new Date(
      new Date(input.to + "T00:00:00+07:00").getTime() + 86400000
    );
    const [fuels, openings] = await Promise.all([
      db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(
          and(eq(products.branchId, branchId), eq(products.category, "fuel"))
        ),
      db
        .select()
        .from(fuelCostOpenings)
        .where(eq(fuelCostOpenings.branchId, branchId)),
    ]);
    const active = openings.filter(opening => opening.effectiveAt < to);
    const first = active.length
      ? new Date(
          Math.min(...active.map(opening => opening.effectiveAt.getTime()))
        )
      : to;
    const [receipts, sold] = await Promise.all([
      db
        .select({
          id: tankRefills.id,
          productId: sql<number>`coalesce(${tankRefills.costProductId}, ${fuelTanks.productId})`,
          at: tankRefills.createdAt,
          liters: tankRefills.liters,
          netAmount: tankRefills.netCostAmount,
        })
        .from(tankRefills)
        .innerJoin(
          fuelTanks,
          and(
            eq(fuelTanks.id, tankRefills.tankId),
            eq(fuelTanks.branchId, branchId)
          )
        )
        .where(
          and(
            eq(tankRefills.branchId, branchId),
            gte(tankRefills.createdAt, first),
            lt(tankRefills.createdAt, to)
          )
        ),
      db
        .select({
          id: saleItems.id,
          originalItemId: saleItems.originalSaleItemId,
          productId: saleItems.productId,
          at: sales.createdAt,
          qty: saleItems.qty,
          amount: saleItems.amount,
          subtotal: sales.subtotal,
          total: sales.total,
          vatAmount: sales.vatAmount,
          reference: sales.receiptNo,
          transactionType: sales.transactionType,
        })
        .from(saleItems)
        .innerJoin(
          sales,
          and(eq(sales.id, saleItems.saleId), eq(sales.branchId, branchId))
        )
        .where(
          and(
            eq(saleItems.branchId, branchId),
            eq(sales.status, "completed"),
            eq(saleItems.productCategory, "fuel"),
            gte(sales.createdAt, first),
            lt(sales.createdAt, to)
          )
        ),
    ]);
    const items = fuels.map(product => {
      const opening = openings.find(row => row.productId === product.id);
      if (!opening || opening.effectiveAt >= to)
        return { ...product, ledger: null };
      const events: FuelCostEvent[] = [
        ...receipts
          .filter(row => row.productId === product.id)
          .map(row => ({
            id: "receipt-" + row.id,
            at: row.at.toISOString(),
            kind: "receipt" as const,
            liters: row.liters,
            netAmount: row.netAmount,
            reference: "รับเข้า #" + row.id,
          })),
        ...sold
          .filter(row => row.productId === product.id)
          .map(row => ({
            id: String(row.id),
            originalItemId:
              row.originalItemId != null
                ? String(row.originalItemId)
                : undefined,
            at: row.at.toISOString(),
            kind:
              row.transactionType === "return"
                ? ("return" as const)
                : ("sale" as const),
            liters: Math.abs(row.qty),
            netAmount:
              row.subtotal !== 0
                ? row.amount * ((row.total - row.vatAmount) / row.subtotal)
                : 0,
            reference: row.reference,
          })),
      ];
      const ledger = calculateFuelCostLedger(
        {
          at: opening.effectiveAt.toISOString(),
          liters: opening.liters,
          unitCost: opening.unitCost,
        },
        events,
        from.toISOString(),
        to.toISOString()
      );
      return {
        ...product,
        ledger: {
          ...ledger,
          eventCount: ledger.rows.length,
          rows: ledger.rows.slice(-1000),
          openingAt: opening.effectiveAt,
        },
      };
    });
    return { from: input.from, to: input.to, items };
  }),
});

import { z } from "zod";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { sales, taxInvoices } from "@db/schema";

export const taxInvoiceRouter = createRouter({
  bySale: publicQuery.input(z.object({ saleId: z.number() })).query(async ({ input }) => {
    const row = await getDb().query.taxInvoices.findFirst({ where: eq(taxInvoices.saleId, input.saleId) });
    return row ?? null;
  }),

  // รายการใบกำกับภาษี + ค้นหา (เลขที่ / ลูกค้า / เลขผู้เสียภาษี / เลขใบเสร็จย่อ)
  list: publicQuery
    .input(z.object({ q: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      const q = input?.q?.trim();
      const pattern = q ? `%${q}%` : null;
      const rows = await getDb()
        .select({ ti: taxInvoices, sale: sales })
        .from(taxInvoices)
        .innerJoin(sales, eq(taxInvoices.saleId, sales.id))
        .where(
          pattern
            ? or(
                like(taxInvoices.taxInvoiceNo, pattern),
                like(taxInvoices.customerName, pattern),
                like(taxInvoices.customerTaxId, pattern),
                like(sales.receiptNo, pattern),
              )
            : undefined,
        )
        .orderBy(desc(taxInvoices.createdAt))
        .limit(input?.limit ?? 100);
      return rows.map((r) => ({
        ...r.ti,
        receiptNo: r.sale.receiptNo,
        saleTotal: r.sale.total,
        saleDate: r.sale.createdAt,
        saleStatus: r.sale.status,
      }));
    }),

  // บิลที่สำเร็จแล้วแต่ยังไม่มีใบกำกับภาษีเต็มรูป (สำหรับหน้าออกใบกำกับย้อนหลัง)
  salesAvailable: publicQuery.query(async () => {
    const rows = await getDb()
      .select({ sale: sales })
      .from(sales)
      .leftJoin(taxInvoices, eq(taxInvoices.saleId, sales.id))
      .where(and(isNull(taxInvoices.id), eq(sales.status, "completed")))
      .orderBy(desc(sales.createdAt))
      .limit(50);
    return rows.map((r) => r.sale);
  }),

  // ลบใบกำกับภาษี (admin) — บิลขายยังคงอยู่ ออกใบกำกับใหม่ได้
  remove: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(taxInvoices).where(eq(taxInvoices.id, input.id));
    return { ok: true };
  }),

  save: publicQuery
    .input(
      z.object({
        saleId: z.number(),
        customerName: z.string().min(1, "กรุณาระบุชื่อลูกค้า"),
        customerTaxId: z.string().default(""),
        customerBranch: z.string().default(""),
        customerAddress: z.string().default(""),
        customerPhone: z.string().default(""),
        vehiclePlate: z.string().default(""),
        issuedBy: z.string().default(""),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.saleId) });
      if (!sale) throw new Error("ไม่พบบิล");
      if (sale.status !== "completed") throw new Error("บิลถูกยกเลิกแล้ว ไม่สามารถออกใบกำกับภาษีได้");

      const customer = {
        customerName: input.customerName,
        customerTaxId: input.customerTaxId,
        customerBranch: input.customerBranch,
        customerAddress: input.customerAddress,
        customerPhone: input.customerPhone,
        vehiclePlate: input.vehiclePlate,
      };

      const existing = await db.query.taxInvoices.findFirst({ where: eq(taxInvoices.saleId, input.saleId) });
      if (existing) {
        // แก้ได้เฉพาะข้อมูลลูกค้า เลขที่ใบกำกับคงเดิม
        await db.update(taxInvoices).set(customer).where(eq(taxInvoices.id, existing.id));
        return db.query.taxInvoices.findFirst({ where: eq(taxInvoices.id, existing.id) });
      }

      return db.transaction(async tx => {
        const taxInvoiceNo = await nextDocNo(tx, "tax_invoice");
        const [invoice] = await tx
          .insert(taxInvoices)
          .values({ taxInvoiceNo, saleId: input.saleId, issuedBy: input.issuedBy, ...customer })
          .returning();
        return invoice;
      });
    }),
});

import { z } from "zod";
import { and, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery, managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { outstandingOf } from "../lib/debt";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  products,
  nozzles,
  shifts,
  shiftReadings,
  sales,
  saleItems,
  members,
  pointTransactions,
  fuelTanks,
  taxInvoices,
  customers,
  settings,
  type Sale,
  type SaleItem,
} from "@db/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function getSettingMap(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
}

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * คืนสต๊อก (เฉพาะสินค้าที่ไม่ใช่น้ำมัน) และคืนแต้มสมาชิกของบิล
 * ใช้ตอนยกเลิก/ลบบิล — ต้องเรียกภายใน transaction (sync สำหรับ better-sqlite3)
 */
function reverseSaleEffects(tx: DbTx, sale: Sale, items: SaleItem[], note: string) {
  const prodRows = tx.select().from(products).all();
  for (const it of items) {
    const p = prodRows.find((pr) => pr.id === it.productId);
    if (p && p.category !== "fuel") {
      tx.update(products)
        .set({ stockQty: r2(p.stockQty + it.qty) })
        .where(eq(products.id, p.id))
        .run();
    }
  }
  if (sale.memberId) {
    const m = tx.select().from(members).where(eq(members.id, sale.memberId)).get();
    if (m) {
      const restored = m.points - sale.pointsEarned + sale.pointsRedeemed;
      tx.update(members).set({ points: restored }).where(eq(members.id, m.id)).run();
      tx.insert(pointTransactions).values({
        memberId: m.id,
        saleId: sale.id,
        type: "adjust",
        points: -(sale.pointsEarned - sale.pointsRedeemed),
        note,
      }).run();
    }
  }
}

export const posRouter = createRouter({
  // ============ กะการทำงาน ============
  currentShift: publicQuery.query(async () => {
    const db = getDb();
    const shift = await db.query.shifts.findFirst({
      where: eq(shifts.status, "open"),
      orderBy: (s, { desc: d }) => [d(s.openedAt)],
    });
    if (!shift) return null;
    const readings = await db.select().from(shiftReadings).where(eq(shiftReadings.shiftId, shift.id));
    const nozzleRows = await db.query.nozzles.findMany();
    const pumpRows = await db.query.pumps.findMany();
    return {
      ...shift,
      readings: readings.map((r) => {
        const nz = nozzleRows.find((n) => n.id === r.nozzleId);
        return { ...r, nozzle: nz ?? null, pump: pumpRows.find((p) => p.id === nz?.pumpId) ?? null };
      }),
    };
  }),

  openShift: publicQuery
    .input(
      z.object({
        staffId: z.number().optional(),
        staffName: z.string().min(1),
        readings: z
          .array(
            z.object({
              nozzleId: z.number(),
              openMeter: z.number().nonnegative(),
              openMoney: z.number().nonnegative(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.shifts.findFirst({ where: eq(shifts.status, "open") });
      if (existing) throw new Error("มีกะที่เปิดอยู่แล้ว กรุณาปิดกะก่อน");
      const prodRows = await db.query.products.findMany();
      const nozzleRows = await db.query.nozzles.findMany();

      const [{ id: shiftId }] = await db
        .insert(shifts)
        .values({ staffId: input.staffId, staffName: input.staffName })
        .returning({ id: shifts.id });
      for (const rd of input.readings) {
        const nz = nozzleRows.find((n) => n.id === rd.nozzleId);
        const prod = prodRows.find((p) => p.id === nz?.productId);
        await db.insert(shiftReadings).values({
          shiftId,
          nozzleId: rd.nozzleId,
          openMeter: rd.openMeter,
          openMoney: rd.openMoney,
          pricePerLiter: prod?.price ?? 0,
        });
      }
      return { ok: true, shiftId };
    }),

  closeShift: publicQuery
    .input(
      z.object({
        shiftId: z.number(),
        readings: z
          .array(
            z.object({
              nozzleId: z.number(),
              closeMeter: z.number().nonnegative(),
              closeMoney: z.number().nonnegative(),
            }),
          )
          .min(1),
        countedCash: z.number().nonnegative().optional(), // เงินสดที่นับได้จริงตอนปิดกะ
        transferAmount: z.number().nonnegative().optional(), // ยอดเงินที่ลูกค้าโอน
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, input.shiftId) });
      if (!shift || shift.status !== "open") throw new Error("ไม่พบกะที่เปิดอยู่");

      const readings = await db.select().from(shiftReadings).where(eq(shiftReadings.shiftId, shift.id));
      const nozzleRows = await db.query.nozzles.findMany();
      const tankRows = await db.query.fuelTanks.findMany();

      let totalLiters = 0;
      let totalAmount = 0;
      let totalMoneyMeter = 0;

      db.transaction((tx) => {
        for (const rd of input.readings) {
          const open = readings.find((o) => o.nozzleId === rd.nozzleId);
          if (!open) throw new Error("ไม่พบเลขตั้งต้นของหัวจ่าย");
          if (rd.closeMeter < open.openMeter) throw new Error("เลขลิตรปิดกะต้องมากกว่าหรือเท่าเลขตั้งต้น");
          const liters = r2(rd.closeMeter - open.openMeter);
          // กะที่เปิดก่อนมีระบบ P จะมี openMoney = 0 → ข้ามการเทียบยอด P รอบนี้
          // แต่ยังบันทึก P ปลายทางลงหัวจ่าย เพื่อให้กะถัดไปเทียบได้ถูกต้อง
          let money = 0;
          if (open.openMoney > 0) {
            if (rd.closeMoney < open.openMoney) throw new Error("เลขเงินปิดกะ (P) ต้องมากกว่าหรือเท่าเลขตั้งต้น");
            money = r2(rd.closeMoney - open.openMoney);
          }
          totalLiters = r2(totalLiters + liters);
          totalAmount = r2(totalAmount + liters * open.pricePerLiter);
          totalMoneyMeter = r2(totalMoneyMeter + money);

          tx.update(shiftReadings)
            .set({ closeMeter: rd.closeMeter, closeMoney: rd.closeMoney })
            .where(eq(shiftReadings.id, open.id))
            .run();
          // อัปเดตมิเตอร์หัวจ่าย (ทั้งลิตรและเงิน)
          tx.update(nozzles)
            .set({ currentMeter: rd.closeMeter, currentMoney: rd.closeMoney })
            .where(eq(nozzles.id, rd.nozzleId))
            .run();
          // หักถังน้ำมันตามลิตรที่ขาย (มิเตอร์คือแหล่งความจริงของน้ำมันออก)
          const nz = nozzleRows.find((n) => n.id === rd.nozzleId);
          const tank = tankRows.find((t) => t.productId === nz?.productId);
          if (tank && liters > 0) {
            tx.update(fuelTanks)
              .set({ currentLiters: r2(Math.max(0, tank.currentLiters - liters)) })
              .where(eq(fuelTanks.id, tank.id))
              .run();
          }
        }
        // ยอดขาย POS ในกะ
        const posRows = tx
          .select({ sum: sql<number>`coalesce(sum(${sales.total}),0)` })
          .from(sales)
          .where(and(eq(sales.shiftId, shift.id), eq(sales.status, "completed")))
          .all();
        tx.update(shifts)
          .set({
            status: "closed",
            closedAt: new Date(),
            totalLiters,
            totalAmount,
            totalMoneyMeter,
            posAmount: r2(posRows[0]?.sum ?? 0),
            countedCash: input.countedCash != null ? r2(input.countedCash) : null,
            transferAmount: input.transferAmount != null ? r2(input.transferAmount) : null,
            note: input.note,
          })
          .where(eq(shifts.id, shift.id))
          .run();
      });
      return { ok: true, totalLiters, totalAmount, totalMoneyMeter, diff: r2(totalMoneyMeter - totalAmount) };
    }),

  shiftHistory: publicQuery.query(async () => {
    return getDb().query.shifts.findMany({
      orderBy: (s, { desc: d }) => [d(s.openedAt)],
      limit: 50,
    });
  }),

  shiftDetail: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, input.id) });
    if (!shift) throw new Error("ไม่พบกะ");
    const readings = await db.select().from(shiftReadings).where(eq(shiftReadings.shiftId, shift.id));
    const nozzleRows = await db.query.nozzles.findMany();
    const prodRows = await db.query.products.findMany();
    const saleRows = await db
      .select()
      .from(sales)
      .where(eq(sales.shiftId, shift.id))
      .orderBy(desc(sales.createdAt));
    return {
      ...shift,
      sales: saleRows,
      readings: readings.map((r) => {
        const nz = nozzleRows.find((n) => n.id === r.nozzleId);
        const prod = prodRows.find((p) => p.id === nz?.productId);
        const liters = r.closeMeter != null ? r2(r.closeMeter - r.openMeter) : null;
        const money = r.closeMoney != null && r.openMoney > 0 ? r2(r.closeMoney - r.openMoney) : null;
        const amountL = liters != null ? r2(liters * r.pricePerLiter) : null;
        return {
          ...r,
          nozzle: nz ?? null,
          product: prod ?? null,
          liters,
          money, // ยอดจากมิเตอร์เงิน P
          amount: amountL, // ยอดจากลิตร × ราคา
          diff: money != null && amountL != null ? r2(money - amountL) : null, // ผลต่าง P − (L×ราคา)
        };
      }),
    };
  }),

  // ============ การขาย (POS) ============
  createSale: publicQuery
    .input(
      z.object({
        shiftId: z.number().optional(),
        staffName: z.string().default(""),
        memberId: z.number().optional(),
        items: z
          .array(z.object({ productId: z.number(), qty: z.number().positive() }))
          .min(1),
        discount: z.number().nonnegative().default(0),
        paymentMethod: z.enum(["cash", "qr", "card", "credit"]).default("cash"),
        customerId: z.number().int().positive().optional(), // บังคับเมื่อ paymentMethod = credit
        received: z.number().nonnegative().default(0),
        pointsToRedeem: z.number().int().nonnegative().default(0),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const prodRows = await db.query.products.findMany();
      const settingMap = await getSettingMap(db);
      const vatRate = Number(settingMap.vat_rate ?? "7");
      const earnPer = Number(settingMap.point_earn_per_baht ?? "25");
      const pointValue = Number(settingMap.point_redeem_value ?? "1");

      // คำนวณราคาฝั่งเซิร์ฟเวอร์เสมอ
      const lines = input.items.map((it) => {
        const p = prodRows.find((pr) => pr.id === input.items.find((x) => x.productId === pr.id)?.productId && pr.id === it.productId);
        if (!p || !p.active) throw new Error("ไม่พบสินค้าบางรายการ");
        return { product: p, qty: it.qty, amount: r2(p.price * it.qty) };
      });
      const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));

      // แลกแต้มเป็นส่วนลด
      let member: typeof members.$inferSelect | undefined;
      let redeemDiscount = 0;
      if (input.memberId) {
        member = await db.query.members.findFirst({ where: eq(members.id, input.memberId) });
        if (!member) throw new Error("ไม่พบสมาชิก");
        if (input.pointsToRedeem > 0) {
          if (input.pointsToRedeem > member.points) throw new Error("แต้มไม่พอ");
          redeemDiscount = r2(input.pointsToRedeem * pointValue);
        }
      }
      const totalDiscount = r2(input.discount + redeemDiscount);
      if (totalDiscount > subtotal) throw new Error("ส่วนลดมากกว่ายอดขาย");

      const total = r2(subtotal - totalDiscount);
      const vatAmount = r2((total * vatRate) / (100 + vatRate)); // VAT รวมใน
      const changeAmt = input.paymentMethod === "cash" ? r2(Math.max(0, input.received - total)) : 0;
      const pointsEarned = member ? Math.floor(total / earnPer) : 0;

      // ขายเชื่อ: บังคับเลือกลูกค้า และเช็กวงเงินเครดิต (creditLimit = 0 คือไม่จำกัด)
      let customer: typeof customers.$inferSelect | undefined;
      if (input.paymentMethod === "credit") {
        if (!input.customerId) throw new Error("ขายเชื่อต้องเลือกลูกค้า");
        customer = await db.query.customers.findFirst({ where: eq(customers.id, input.customerId) });
        if (!customer) throw new Error("ไม่พบลูกค้า");
        if (customer.creditLimit > 0) {
          const outstanding = await outstandingOf(db, customer.id);
          if (r2(outstanding + total) > customer.creditLimit) {
            throw new Error(
              `เกินวงเงินเครดิตของลูกค้า (ค้างชำระ ${outstanding.toFixed(2)} บาท / วงเงิน ${customer.creditLimit.toFixed(2)} บาท)`,
            );
          }
        }
      }

      const saleId = db.transaction((tx) => {
        const receiptNo = nextDocNo(tx, "receipt");
        const [{ id }] = tx
          .insert(sales)
          .values({
            receiptNo,
            shiftId: input.shiftId,
            staffName: input.staffName,
            memberId: input.memberId,
            customerId: input.paymentMethod === "credit" ? input.customerId : null,
            subtotal,
            discount: totalDiscount,
            vatRate,
            vatAmount,
            total,
            paymentMethod: input.paymentMethod,
            received: input.paymentMethod === "cash" ? input.received : total,
            changeAmt,
            pointsEarned,
            pointsRedeemed: input.pointsToRedeem,
          })
          .returning({ id: sales.id })
          .all();

        for (const l of lines) {
          tx.insert(saleItems).values({
            saleId: id,
            productId: l.product.id,
            name: l.product.name,
            qty: l.qty,
            unit: l.product.unit,
            unitPrice: l.product.price,
            amount: l.amount,
          }).run();
          // หักสต๊อกเฉพาะสินค้าที่ไม่ใช่น้ำมัน (น้ำมันหักผ่านมิเตอร์ตอนปิดกะ)
          if (l.product.category !== "fuel") {
            tx.update(products)
              .set({ stockQty: r2(l.product.stockQty - l.qty) })
              .where(eq(products.id, l.product.id))
              .run();
          }
        }

        if (member) {
          const newPoints = member.points - input.pointsToRedeem + pointsEarned;
          tx.update(members).set({ points: newPoints }).where(eq(members.id, member.id)).run();
          if (pointsEarned > 0) {
            tx.insert(pointTransactions).values({
              memberId: member.id,
              saleId: id,
              type: "earn",
              points: pointsEarned,
              note: `รับแต้มจากบิล ${receiptNo}`,
            }).run();
          }
          if (input.pointsToRedeem > 0) {
            tx.insert(pointTransactions).values({
              memberId: member.id,
              saleId: id,
              type: "redeem",
              points: -input.pointsToRedeem,
              note: `ใช้แต้มลดบิล ${receiptNo}`,
            }).run();
          }
        }
        return id;
      });

      const sale = await db.query.sales.findFirst({ where: eq(sales.id, saleId) });
      const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));
      return { sale: { ...sale!, memberName: member?.name ?? null, customerName: customer?.name ?? null }, items };
    }),

  salesHistory: publicQuery
    .input(
      z
        .object({
          q: z.string().optional(), // ค้นหา: เลขที่บิล / พนักงาน / ชื่อหรือเบอร์สมาชิก
          status: z.enum(["completed", "voided"]).optional(),
          limit: z.number().default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const q = input?.q?.trim();
      const conds = [];
      if (input?.status) conds.push(eq(sales.status, input.status));
      if (q) {
        const pattern = `%${q}%`;
        const matchedMembers = await db
          .select({ id: members.id })
          .from(members)
          .where(or(like(members.name, pattern), like(members.phone, pattern)));
        const memberIds = matchedMembers.map((m) => m.id);
        const qConds = [like(sales.receiptNo, pattern), like(sales.staffName, pattern)];
        if (memberIds.length > 0) qConds.push(inArray(sales.memberId, memberIds));
        conds.push(or(...qConds));
      }
      const rows = await db
        .select()
        .from(sales)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(sales.createdAt))
        .limit(input?.limit ?? 200);
      const memberRows = await db.query.members.findMany();
      return rows.map((s) => ({
        ...s,
        memberName: memberRows.find((m) => m.id === s.memberId)?.name ?? null,
      }));
    }),

  saleDetail: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.id) });
    if (!sale) throw new Error("ไม่พบบิล");
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const member = sale.memberId
      ? await db.query.members.findFirst({ where: eq(members.id, sale.memberId) })
      : null;
    const customer = sale.customerId
      ? await db.query.customers.findFirst({ where: eq(customers.id, sale.customerId) })
      : null;
    return { sale, items, memberName: member?.name ?? null, customerName: customer?.name ?? null };
  }),

  voidSale: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.id) });
    if (!sale || sale.status === "voided") throw new Error("ยกเลิกบิลไม่ได้");
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    db.transaction((tx) => {
      tx.update(sales).set({ status: "voided" }).where(eq(sales.id, sale.id)).run();
      // คืนสต๊อกและแต้มอัตโนมัติ
      reverseSaleEffects(tx, sale, items, `ยกเลิกบิล ${sale.receiptNo}`);
    });
    logAudit({
      action: "void_sale",
      ...actorFromReq(ctx.req),
      detail: `ยกเลิกบิล ${sale.receiptNo} ยอด ${sale.total.toFixed(2)} บาท`,
      refType: "sale",
      refId: sale.id,
    });
    return { ok: true };
  }),

  // แก้ไขหัวบิล (admin/manager) — คำนวณยอดสุทธิ VAT และแต้มใหม่อัตโนมัติ
  updateSale: managerQuery
    .input(
      z.object({
        id: z.number(),
        staffName: z.string().min(1).optional(),
        paymentMethod: z.enum(["cash", "qr", "card", "credit"]).optional(),
        discount: z.number().nonnegative().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.id) });
      if (!sale) throw new Error("ไม่พบบิล");
      if (sale.status === "voided") throw new Error("แก้ไขบิลที่ยกเลิกแล้วไม่ได้");

      const discount = input.discount ?? sale.discount;
      if (discount > sale.subtotal) throw new Error("ส่วนลดมากกว่ายอดขาย");
      const paymentMethod = input.paymentMethod ?? sale.paymentMethod;
      const total = r2(sale.subtotal - discount);
      const vatAmount = r2((total * sale.vatRate) / (100 + sale.vatRate)); // VAT รวมใน
      const received = paymentMethod === "cash" ? sale.received : total;
      const changeAmt = paymentMethod === "cash" ? r2(Math.max(0, received - total)) : 0;

      const settingMap = await getSettingMap(db);
      const earnPer = Number(settingMap.point_earn_per_baht ?? "25");
      const pointsEarned = sale.memberId ? Math.floor(total / earnPer) : 0;

      db.transaction((tx) => {
        tx.update(sales)
          .set({
            staffName: input.staffName ?? sale.staffName,
            paymentMethod,
            discount,
            total,
            vatAmount,
            received,
            changeAmt,
            pointsEarned,
          })
          .where(eq(sales.id, sale.id))
          .run();
        // ปรับแต้มสมาชิกตามยอดใหม่ (เฉพาะส่วนต่าง)
        if (sale.memberId && pointsEarned !== sale.pointsEarned) {
          const diff = pointsEarned - sale.pointsEarned;
          const m = tx.select().from(members).where(eq(members.id, sale.memberId!)).get();
          if (m) {
            tx.update(members).set({ points: m.points + diff }).where(eq(members.id, m.id)).run();
            tx.insert(pointTransactions).values({
              memberId: m.id,
              saleId: sale.id,
              type: "adjust",
              points: diff,
              note: `ปรับแต้มจากแก้ไขบิล ${sale.receiptNo}`,
            }).run();
          }
        }
      });
      const changes: string[] = [];
      if (input.staffName !== undefined && input.staffName !== sale.staffName) {
        changes.push(`พนักงาน ${sale.staffName || "-"}→${input.staffName}`);
      }
      if (input.paymentMethod !== undefined && input.paymentMethod !== sale.paymentMethod) {
        changes.push(`วิธีชำระ ${sale.paymentMethod}→${input.paymentMethod}`);
      }
      if (input.discount !== undefined && input.discount !== sale.discount) {
        changes.push(`ส่วนลด ${sale.discount}→${input.discount}`);
      }
      logAudit({
        action: "update_sale",
        ...actorFromReq(ctx.req),
        detail: `แก้บิล ${sale.receiptNo}${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`,
        refType: "sale",
        refId: sale.id,
      });
      return db.query.sales.findFirst({ where: eq(sales.id, sale.id) });
    }),

  // ลบบิลถาวร (admin/manager) — คืนสต๊อกและแต้มก่อนลบ
  deleteSale: managerQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.id) });
    if (!sale) throw new Error("ไม่พบบิล");
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    db.transaction((tx) => {
      if (sale.status === "completed") {
        reverseSaleEffects(tx, sale, items, `ลบบิล ${sale.receiptNo}`);
      }
      tx.delete(taxInvoices).where(eq(taxInvoices.saleId, sale.id)).run();
      tx.delete(saleItems).where(eq(saleItems.saleId, sale.id)).run();
      tx.delete(sales).where(eq(sales.id, sale.id)).run();
    });
    logAudit({
      action: "delete_sale",
      ...actorFromReq(ctx.req),
      detail: `ลบบิล ${sale.receiptNo} ถาวร`,
      refType: "sale",
      refId: sale.id,
    });
    return { ok: true };
  }),

  // ============ Dashboard ============
  dashboard: publicQuery.query(async () => {
    const db = getDb();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ยอดวันนี้
    const todayRows = await db
      .select({
        total: sql<number>`coalesce(sum(${sales.total}),0)`,
        bills: sql<number>`count(*)`,
      })
      .from(sales)
      .where(and(gte(sales.createdAt, startOfDay), eq(sales.status, "completed")));

    // ลิตรวันนี้ (จาก sale_items หน่วยลิตร)
    const todaySaleIds = (await db
      .select({ id: sales.id })
      .from(sales)
      .where(and(gte(sales.createdAt, startOfDay), eq(sales.status, "completed")))).map((r) => r.id);
    let litersToday = 0;
    const fuelByCode: Record<string, { name: string; liters: number; amount: number }> = {};
    if (todaySaleIds.length > 0) {
      const itemRows = await db
        .select()
        .from(saleItems)
        .where(inArray(saleItems.saleId, todaySaleIds));
      const prodRows = await db.query.products.findMany();
      for (const it of itemRows) {
        if (it.unit === "ลิตร") {
          litersToday = r2(litersToday + it.qty);
          const code = prodRows.find((p) => p.id === it.productId)?.code ?? "OTHER";
          if (!fuelByCode[code]) fuelByCode[code] = { name: it.name, liters: 0, amount: 0 };
          fuelByCode[code].liters = r2(fuelByCode[code].liters + it.qty);
          fuelByCode[code].amount = r2(fuelByCode[code].amount + it.amount);
        }
      }
    }

    // กราฟ 7 วันย้อนหลัง
    const chart: { date: string; label: string; total: number; bills: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
      const rows = await db
        .select({ total: sql<number>`coalesce(sum(${sales.total}),0)`, bills: sql<number>`count(*)` })
        .from(sales)
        .where(and(gte(sales.createdAt, d0), lt(sales.createdAt, d1), eq(sales.status, "completed")));
      chart.push({
        date: d0.toISOString().slice(0, 10),
        label: `${d0.getDate()}/${d0.getMonth() + 1}`,
        total: r2(rows[0]?.total ?? 0),
        bills: rows[0]?.bills ?? 0,
      });
    }

    // กะปัจจุบัน
    const openShift = await db.query.shifts.findFirst({
      where: eq(shifts.status, "open"),
      orderBy: (s, { desc: d }) => [d(s.openedAt)],
    });

    // สต๊อกต่ำ
    const tankRows = await db.query.fuelTanks.findMany();
    const lowTanks = tankRows.filter((t) => t.currentLiters <= t.lowAlertAt);
    const prodRows2 = await db.query.products.findMany();
    const lowProducts = prodRows2.filter((p) => p.active && p.category !== "fuel" && p.stockQty <= p.lowStockAt);

    // บิลล่าสุด
    const recent = await db.select().from(sales).orderBy(desc(sales.createdAt)).limit(8);

    return {
      todayTotal: r2(todayRows[0]?.total ?? 0),
      todayBills: todayRows[0]?.bills ?? 0,
      litersToday,
      fuelByCode,
      chart,
      openShift: openShift ?? null,
      lowTanks,
      lowProducts,
      recentSales: recent,
    };
  }),
});

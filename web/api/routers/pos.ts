import { z } from "zod";
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  like,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery, managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { outstandingOf } from "../lib/debt";
import { actorFromReq, logAudit } from "../lib/audit";
import { shiftCashSummary } from "../lib/cash";
import {
  isValidCashCounts,
  sumCashCounts,
  type CashCounts,
} from "@contracts/cash";
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
  priceChanges,
  debtPayments,
  expenses,
  type Sale,
  type SaleItem,
} from "@db/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const shiftHistoryFields = {
  staffId: z.number().int().positive().nullable().optional(),
  staffName: z.string().trim().min(1).max(100),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date(),
  totalLiters: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  totalMoneyMeter: z.number().nonnegative(),
  posAmount: z.number().nonnegative(),
  openingFloat: z.number().nonnegative(),
  countedCash: z.number().nonnegative().nullable(),
  transferAmount: z.number().nonnegative().nullable(),
  expectedCash: z.number().nonnegative().nullable(),
  note: z.string().trim().max(1000).nullable(),
};

const shiftHistoryRecordInput = z
  .object({
    ...shiftHistoryFields,
    readings: z
      .array(
        z.object({
          nozzleId: z.number().int().positive(),
          openMeter: z.number().nonnegative(),
          closeMeter: z.number().nonnegative(),
          openMoney: z.number().nonnegative(),
          closeMoney: z.number().nonnegative(),
        })
      )
      .min(1)
      .optional(),
  })
  .refine(value => value.closedAt >= value.openedAt, {
    message: "เวลาปิดกะต้องไม่ก่อนเวลาเปิดกะ",
    path: ["closedAt"],
  });

const shiftHistoryUpdateInput = z
  .object({
    id: z.number().int().positive(),
    ...shiftHistoryFields,
    readings: z
      .array(
        z.object({
          nozzleId: z.number().int().positive(),
          closeMeter: z.number().nonnegative(),
          closeMoney: z.number().nonnegative(),
        })
      )
      .optional(),
  })
  .refine(value => value.closedAt >= value.openedAt, {
    message: "เวลาปิดกะต้องไม่ก่อนเวลาเปิดกะ",
    path: ["closedAt"],
  });

const shiftHistorySearchInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["open", "closed"]).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().positive().max(500).default(200),
});

const historyShifts = alias(shifts, "history_shifts");

const shiftHistorySelection = {
  ...getTableColumns(historyShifts),
  priceChangedDuringShift: sql<boolean>`exists (
    select 1
    from ${priceChanges} as "history_price_changes"
    inner join ${nozzles} as "history_nozzles"
      on "history_nozzles"."product_id" = "history_price_changes"."product_id"
    inner join ${shiftReadings} as "history_shift_readings"
      on "history_shift_readings"."nozzle_id" = "history_nozzles"."id"
      and "history_shift_readings"."branch_id" = "history_shifts"."branch_id"
    where "history_shift_readings"."shift_id" = "history_shifts"."id"
      and "history_price_changes"."branch_id" = "history_shifts"."branch_id"
      and "history_price_changes"."created_at" >= "history_shifts"."opened_at"
      and "history_price_changes"."created_at" <= coalesce("history_shifts"."closed_at", current_timestamp)
  )`,
};

async function getSettingMap(db: ReturnType<typeof getDb>, branchId: number) {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.branchId, branchId));
  return Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<
    string,
    string
  >;
}

type DbTx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

/**
 * คืนสต๊อก (เฉพาะสินค้าที่ไม่ใช่น้ำมัน) และคืนแต้มสมาชิกของบิล
 * ใช้ตอนยกเลิก/ลบบิลภายใน transaction เดียวกัน
 */
async function reverseSaleEffects(
  tx: DbTx,
  sale: Sale,
  items: SaleItem[],
  note: string
) {
  const prodRows = await tx
    .select()
    .from(products)
    .where(eq(products.branchId, sale.branchId));
  for (const it of items) {
    const p = prodRows.find(pr => pr.id === it.productId);
    if (p && p.category !== "fuel") {
      await tx
        .update(products)
        .set({ stockQty: r2(p.stockQty + it.qty) })
        .where(
          and(eq(products.id, p.id), eq(products.branchId, sale.branchId))
        );
    }
  }
  if (sale.memberId) {
    const [m] = await tx
      .select()
      .from(members)
      .where(eq(members.id, sale.memberId));
    if (m) {
      const restored = m.points - sale.pointsEarned + sale.pointsRedeemed;
      await tx
        .update(members)
        .set({ points: restored })
        .where(eq(members.id, m.id));
      await tx.insert(pointTransactions).values({
        branchId: sale.branchId,
        memberId: m.id,
        saleId: sale.id,
        type: "adjust",
        points: -(sale.pointsEarned - sale.pointsRedeemed),
        note,
      });
    }
  }
}

export const posRouter = createRouter({
  // ============ กะการทำงาน ============
  currentShift: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const shift = await db.query.shifts.findFirst({
      where: and(eq(shifts.branchId, branchId), eq(shifts.status, "open")),
      orderBy: (s, { desc: d }) => [d(s.openedAt)],
    });
    if (!shift) return null;
    const [readings, nozzleRows, pumpRows, productRows, priceChangeRows, cash] =
      await Promise.all([
        db
          .select()
          .from(shiftReadings)
          .where(
            and(
              eq(shiftReadings.shiftId, shift.id),
              eq(shiftReadings.branchId, branchId)
            )
          ),
        db.query.nozzles.findMany({
          where: (row, operators) => operators.eq(row.branchId, branchId),
        }),
        db.query.pumps.findMany({
          where: (row, operators) => operators.eq(row.branchId, branchId),
        }),
        db.query.products.findMany({
          where: eq(products.branchId, branchId),
        }),
        db
          .select()
          .from(priceChanges)
          .where(
            and(
              eq(priceChanges.branchId, branchId),
              gte(priceChanges.createdAt, shift.openedAt)
            )
          ),
        shiftCashSummary(db, shift),
      ]);
    return {
      ...shift,
      cash, // สรุปเงินสดของกะ (ใช้โชว์ยอด "ควรมี" ตอนปิดกะ)
      readings: readings.map(r => {
        const nz = nozzleRows.find(n => n.id === r.nozzleId);
        const product = productRows.find(p => p.id === nz?.productId);
        const changesDuringShift = priceChangeRows
          .filter(change => change.productId === nz?.productId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return {
          ...r,
          nozzle: nz ?? null,
          pump: pumpRows.find(p => p.id === nz?.pumpId) ?? null,
          product: product ?? null,
          currentPrice: product?.price ?? r.pricePerLiter,
          priceChangedDuringShift: changesDuringShift.length > 0,
          priceChangesDuringShift: changesDuringShift,
        };
      }),
    };
  }),

  openShift: publicQuery
    .input(
      z.object({
        staffId: z.number().optional(),
        staffName: z.string().min(1),
        openingFloat: z.number().nonnegative().default(0), // เงินทอนเริ่มกะ
        readings: z
          .array(
            z.object({
              nozzleId: z.number(),
              openMeter: z.number().nonnegative(),
              openMoney: z.number().nonnegative(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const existing = await db.query.shifts.findFirst({
        where: and(eq(shifts.branchId, branchId), eq(shifts.status, "open")),
      });
      if (existing) throw new Error("มีกะที่เปิดอยู่แล้ว กรุณาปิดกะก่อน");
      const prodRows = await db.query.products.findMany({
        where: eq(products.branchId, branchId),
      });
      const nozzleRows = await db.query.nozzles.findMany({
        where: (row, operators) => operators.eq(row.branchId, branchId),
      });
      if (
        input.readings.some(
          reading => !nozzleRows.some(row => row.id === reading.nozzleId)
        )
      ) {
        throw new Error("มีหัวจ่ายที่ไม่อยู่ในสาขาปัจจุบัน");
      }

      const [{ id: shiftId }] = await db
        .insert(shifts)
        .values({
          branchId,
          staffId: input.staffId,
          staffName: input.staffName,
          openingFloat: r2(input.openingFloat),
        })
        .returning({ id: shifts.id });
      for (const rd of input.readings) {
        const nz = nozzleRows.find(n => n.id === rd.nozzleId);
        const prod = prodRows.find(p => p.id === nz?.productId);
        await db.insert(shiftReadings).values({
          branchId,
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
            })
          )
          .min(1),
        countedCash: z.number().nonnegative().optional(), // เงินสดที่นับได้จริงตอนปิดกะ (กรณีไม่ได้นับแบงก์)
        transferAmount: z.number().nonnegative().optional(), // ยอดเงินที่ลูกค้าโอน
        cashCounts: z
          .record(z.string(), z.number().int().nonnegative())
          .optional(), // การนับแบงก์/เหรียญ
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const shift = await db.query.shifts.findFirst({
        where: and(eq(shifts.id, input.shiftId), eq(shifts.branchId, branchId)),
      });
      if (!shift || shift.status !== "open")
        throw new Error("ไม่พบกะที่เปิดอยู่");

      // ถ้าส่งการนับแบงก์/เหรียญมา → คำนวณยอดเงินสดนับได้ฝั่งเซิร์ฟเวอร์ (ไม่เชื่อยอดจาก client)
      let countedCash =
        input.countedCash != null ? r2(input.countedCash) : null;
      let cashCountsJson: string | null = null;
      if (input.cashCounts != null) {
        if (!isValidCashCounts(input.cashCounts))
          throw new Error("มูลค่าแบงก์/เหรียญไม่ถูกต้อง");
        countedCash = sumCashCounts(input.cashCounts);
        cashCountsJson = JSON.stringify(input.cashCounts);
      }

      const readings = await db
        .select()
        .from(shiftReadings)
        .where(
          and(
            eq(shiftReadings.shiftId, shift.id),
            eq(shiftReadings.branchId, branchId)
          )
        );
      const nozzleRows = await db.query.nozzles.findMany({
        where: (row, operators) => operators.eq(row.branchId, branchId),
      });
      const tankRows = await db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      });
      // คำนวณเงินสดที่ควรมีก่อนเข้า transaction เพื่อลดเวลาถือ lock
      const cash = await shiftCashSummary(db, shift);

      let totalLiters = 0;
      let totalAmount = 0;
      let totalMoneyMeter = 0;

      await db.transaction(async tx => {
        const tankDeductions = new Map<number, number>();
        for (const rd of input.readings) {
          const open = readings.find(o => o.nozzleId === rd.nozzleId);
          if (!open) throw new Error("ไม่พบเลขตั้งต้นของหัวจ่าย");
          if (rd.closeMeter < open.openMeter)
            throw new Error("เลขลิตรปิดกะต้องมากกว่าหรือเท่าเลขตั้งต้น");
          // มิเตอร์และสต๊อกเก็บ 3 ตำแหน่ง ห้ามปัดเป็นสตางค์ก่อนหักถัง
          const liters = r3(rd.closeMeter - open.openMeter);
          // กะที่เปิดก่อนมีระบบ P จะมี openMoney = 0 → ข้ามการเทียบยอด P รอบนี้
          // แต่ยังบันทึก P ปลายทางลงหัวจ่าย เพื่อให้กะถัดไปเทียบได้ถูกต้อง
          let money = 0;
          if (open.openMoney > 0) {
            if (rd.closeMoney < open.openMoney)
              throw new Error("เลขเงินปิดกะ (P) ต้องมากกว่าหรือเท่าเลขตั้งต้น");
            money = r2(rd.closeMoney - open.openMoney);
          }
          totalLiters = r3(totalLiters + liters);
          totalAmount = r2(totalAmount + liters * open.pricePerLiter);
          totalMoneyMeter = r2(totalMoneyMeter + money);

          await tx
            .update(shiftReadings)
            .set({ closeMeter: rd.closeMeter, closeMoney: rd.closeMoney })
            .where(
              and(
                eq(shiftReadings.id, open.id),
                eq(shiftReadings.branchId, branchId)
              )
            );
          // อัปเดตมิเตอร์หัวจ่าย (ทั้งลิตรและเงิน)
          await tx
            .update(nozzles)
            .set({ currentMeter: rd.closeMeter, currentMoney: rd.closeMoney })
            .where(
              and(eq(nozzles.id, rd.nozzleId), eq(nozzles.branchId, branchId))
            );
          // หักถังน้ำมันตามลิตรที่ขาย (มิเตอร์คือแหล่งความจริงของน้ำมันออก)
          const nz = nozzleRows.find(n => n.id === rd.nozzleId);
          if (!nz) throw new Error("ไม่พบหัวจ่าย");
          if (liters > 0) {
            if (nz.tankId == null) {
              throw new Error(
                `หัวจ่าย ${nz.label} ยังไม่ได้ตั้งค่าถังน้ำมัน กรุณาให้ admin ตั้งค่าก่อนปิดกะ`
              );
            }
            const tank = tankRows.find(t => t.id === nz.tankId);
            if (!tank) throw new Error(`ไม่พบถังน้ำมันของหัวจ่าย ${nz.label}`);
            if (tank.productId !== nz.productId) {
              throw new Error(
                `ถังน้ำมันของหัวจ่าย ${nz.label} ไม่ตรงกับชนิดน้ำมัน`
              );
            }
            tankDeductions.set(
              tank.id,
              r3((tankDeductions.get(tank.id) ?? 0) + liters)
            );
          }
        }
        for (const [tankId, liters] of tankDeductions) {
          const tank = tankRows.find(t => t.id === tankId)!;
          await tx
            .update(fuelTanks)
            .set({
              currentLiters: r3(Math.max(0, tank.currentLiters - liters)),
            })
            .where(
              and(eq(fuelTanks.id, tank.id), eq(fuelTanks.branchId, branchId))
            );
        }
        // ยอดขาย POS ในกะ
        const [posRow] = await tx
          .select({
            sum: sql<number>`coalesce(sum(${sales.total}),0)`
              .mapWith(Number)
              .as("sum"),
          })
          .from(sales)
          .where(
            and(
              eq(sales.branchId, branchId),
              eq(sales.shiftId, shift.id),
              eq(sales.status, "completed")
            )
          );
        await tx
          .update(shifts)
          .set({
            status: "closed",
            closedAt: new Date(),
            totalLiters,
            totalAmount,
            totalMoneyMeter,
            posAmount: r2(posRow?.sum ?? 0),
            countedCash,
            transferAmount:
              input.transferAmount != null ? r2(input.transferAmount) : null,
            expectedCash: cash.expectedCash, // snapshot ยอดควรมี ณ ตอนปิดกะ
            cashCounts: cashCountsJson,
            note: input.note,
          })
          .where(and(eq(shifts.id, shift.id), eq(shifts.branchId, branchId)));
      });

      const cashDiff =
        countedCash != null ? r2(countedCash - cash.expectedCash) : null;
      logAudit({
        action: "close_shift",
        ...actorFromReq(ctx.req),
        detail:
          `ปิดกะ #${shift.id} (${shift.staffName}) ลิตร ${totalLiters} ยอด P ${totalMoneyMeter} ` +
          `เงินทอน ${cash.openingFloat} เงินสดควรมี ${cash.expectedCash} นับได้ ${countedCash ?? "-"} ต่าง ${cashDiff ?? "-"}`,
        refType: "shift",
        refId: shift.id,
      });
      return {
        ok: true,
        totalLiters,
        totalAmount,
        totalMoneyMeter,
        diff: r2(totalMoneyMeter - totalAmount),
      };
    }),

  shiftHistory: publicQuery.query(async ({ ctx }) => {
    return getDb()
      .select(shiftHistorySelection)
      .from(historyShifts)
      .where(eq(historyShifts.branchId, ctx.staff.branchId))
      .orderBy(desc(historyShifts.openedAt), desc(historyShifts.id))
      .limit(50);
  }),

  // ค้นหาและจัดการประวัติการตัดกะ — เฉพาะ admin เจ้าของปั๊ม
  searchShiftHistory: adminQuery
    .input(shiftHistorySearchInput)
    .query(async ({ input, ctx }) => {
      const conditions = [eq(historyShifts.branchId, ctx.staff.branchId)];
      const q = input.q?.trim();
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            like(historyShifts.staffName, pattern),
            like(historyShifts.note, pattern),
            sql<boolean>`cast(${historyShifts.id} as text) like ${pattern}`
          )!
        );
      }
      if (input.status) conditions.push(eq(historyShifts.status, input.status));
      if (input.from) {
        conditions.push(
          gte(historyShifts.openedAt, new Date(`${input.from}T00:00:00`))
        );
      }
      if (input.to) {
        const exclusiveEnd = new Date(`${input.to}T00:00:00`);
        exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
        conditions.push(lt(historyShifts.openedAt, exclusiveEnd));
      }
      return getDb()
        .select(shiftHistorySelection)
        .from(historyShifts)
        .where(and(...conditions))
        .orderBy(desc(historyShifts.openedAt), desc(historyShifts.id))
        .limit(input.limit);
    }),

  createShiftHistory: adminQuery
    .input(shiftHistoryRecordInput)
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const { readings: readingValues, ...values } = input;
      let totalLiters = r3(values.totalLiters);
      let totalAmount = r2(values.totalAmount);
      let totalMoneyMeter = r2(values.totalMoneyMeter);
      const preparedReadings: Array<{
        nozzleId: number;
        openMeter: number;
        closeMeter: number;
        openMoney: number;
        closeMoney: number;
        pricePerLiter: number;
      }> = [];

      if (readingValues) {
        const [nozzleRows, productRows] = await Promise.all([
          db.query.nozzles.findMany({
            where: (row, operators) => operators.eq(row.branchId, branchId),
          }),
          db.query.products.findMany({
            where: eq(products.branchId, branchId),
          }),
        ]);
        const activeNozzles = nozzleRows.filter(nozzle => nozzle.active);
        if (
          readingValues.length !== activeNozzles.length ||
          new Set(readingValues.map(reading => reading.nozzleId)).size !==
            readingValues.length
        ) {
          throw new Error("ข้อมูลหัวจ่ายของกะไม่ครบหรือซ้ำกัน");
        }
        totalLiters = 0;
        totalAmount = 0;
        totalMoneyMeter = 0;
        for (const reading of readingValues) {
          const nozzle = activeNozzles.find(row => row.id === reading.nozzleId);
          if (!nozzle) throw new Error("ไม่พบหัวจ่ายในข้อมูลกะ");
          if (reading.closeMeter < reading.openMeter) {
            throw new Error("เลขลิตรปิดกะต้องมากกว่าหรือเท่าเลขตั้งต้น");
          }
          if (reading.closeMoney < reading.openMoney) {
            throw new Error("เลขเงินปิดกะ (P) ต้องมากกว่าหรือเท่าเลขตั้งต้น");
          }
          const product = productRows.find(row => row.id === nozzle.productId);
          const pricePerLiter = product?.price ?? 0;
          const liters = r3(reading.closeMeter - reading.openMeter);
          const money = r2(reading.closeMoney - reading.openMoney);
          totalLiters = r3(totalLiters + liters);
          totalAmount = r2(totalAmount + r2(liters * pricePerLiter));
          totalMoneyMeter = r2(totalMoneyMeter + money);
          preparedReadings.push({
            nozzleId: reading.nozzleId,
            openMeter: reading.openMeter,
            closeMeter: reading.closeMeter,
            openMoney: r2(reading.openMoney),
            closeMoney: r2(reading.closeMoney),
            pricePerLiter: r2(pricePerLiter),
          });
        }
      }

      const id = await db.transaction(async tx => {
        const [created] = await tx
          .insert(shifts)
          .values({
            branchId,
            ...values,
            staffId: values.staffId ?? null,
            status: "closed",
            totalLiters,
            totalAmount,
            totalMoneyMeter,
            posAmount: r2(values.posAmount),
            openingFloat: r2(values.openingFloat),
            countedCash:
              values.countedCash == null ? null : r2(values.countedCash),
            transferAmount:
              values.transferAmount == null ? null : r2(values.transferAmount),
            expectedCash:
              values.expectedCash == null ? null : r2(values.expectedCash),
            note: values.note || null,
          })
          .returning({ id: shifts.id });
        if (preparedReadings.length > 0) {
          await tx.insert(shiftReadings).values(
            preparedReadings.map(reading => ({
              branchId,
              shiftId: created.id,
              ...reading,
            }))
          );
        }
        return created.id;
      });
      logAudit({
        action: "create_shift_history",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มประวัติตัดกะ #${id} (${values.staffName}) เปิด ${values.openedAt.toISOString()} ปิด ${values.closedAt.toISOString()}${readingValues ? ` พร้อมเลขมิเตอร์ ${readingValues.length} หัวจ่าย` : ""}`,
        refType: "shift",
        refId: id,
      });
      return { ok: true, id, totalLiters, totalAmount, totalMoneyMeter };
    }),

  updateShiftHistory: adminQuery
    .input(shiftHistoryUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const current = await db.query.shifts.findFirst({
        where: and(eq(shifts.id, input.id), eq(shifts.branchId, branchId)),
      });
      if (!current) throw new Error("ไม่พบประวัติการตัดกะ");
      if (current.status === "open") {
        throw new Error("แก้ไขกะที่กำลังเปิดไม่ได้ กรุณาปิดกะก่อน");
      }
      const { id, readings: readingValues, ...values } = input;
      let totalLiters = r3(values.totalLiters);
      let totalAmount = r2(values.totalAmount);
      let totalMoneyMeter = r2(values.totalMoneyMeter);
      const existingReadings = readingValues
        ? await db
            .select()
            .from(shiftReadings)
            .where(
              and(
                eq(shiftReadings.shiftId, id),
                eq(shiftReadings.branchId, branchId)
              )
            )
        : [];

      if (readingValues) {
        if (
          readingValues.length !== existingReadings.length ||
          new Set(readingValues.map(reading => reading.nozzleId)).size !==
            readingValues.length
        ) {
          throw new Error("ข้อมูลหัวจ่ายของกะไม่ครบหรือซ้ำกัน");
        }
        totalLiters = 0;
        totalAmount = 0;
        totalMoneyMeter = 0;
        for (const reading of readingValues) {
          const existing = existingReadings.find(
            row => row.nozzleId === reading.nozzleId
          );
          if (!existing) throw new Error("ไม่พบหัวจ่ายในประวัติกะนี้");
          if (reading.closeMeter < existing.openMeter) {
            throw new Error("เลขลิตรปิดกะต้องมากกว่าหรือเท่าเลขตั้งต้น");
          }
          if (
            existing.openMoney > 0 &&
            reading.closeMoney < existing.openMoney
          ) {
            throw new Error("เลขเงินปิดกะ (P) ต้องมากกว่าหรือเท่าเลขตั้งต้น");
          }
          const liters = r3(reading.closeMeter - existing.openMeter);
          const money =
            existing.openMoney > 0
              ? r2(reading.closeMoney - existing.openMoney)
              : 0;
          totalLiters = r3(totalLiters + liters);
          totalAmount = r2(totalAmount + r2(liters * existing.pricePerLiter));
          totalMoneyMeter = r2(totalMoneyMeter + money);
        }
      }

      await db.transaction(async tx => {
        for (const reading of readingValues ?? []) {
          await tx
            .update(shiftReadings)
            .set({
              closeMeter: r2(reading.closeMeter),
              closeMoney: r2(reading.closeMoney),
            })
            .where(
              and(
                eq(shiftReadings.shiftId, id),
                eq(shiftReadings.nozzleId, reading.nozzleId),
                eq(shiftReadings.branchId, branchId)
              )
            );
        }
        await tx
          .update(shifts)
          .set({
            ...values,
            staffId: values.staffId ?? null,
            status: "closed",
            totalLiters,
            totalAmount,
            totalMoneyMeter,
            posAmount: r2(values.posAmount),
            openingFloat: r2(values.openingFloat),
            countedCash:
              values.countedCash == null ? null : r2(values.countedCash),
            transferAmount:
              values.transferAmount == null ? null : r2(values.transferAmount),
            expectedCash:
              values.expectedCash == null ? null : r2(values.expectedCash),
            cashCounts:
              values.countedCash !== current.countedCash
                ? null
                : current.cashCounts,
            note: values.note || null,
          })
          .where(and(eq(shifts.id, id), eq(shifts.branchId, branchId)));
      });
      logAudit({
        action: "update_shift_history",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขประวัติตัดกะ #${id} (${current.staffName} → ${values.staffName})${readingValues ? ` และเลขปิดกะ ${readingValues.length} หัวจ่าย` : ""}`,
        refType: "shift",
        refId: id,
      });
      return { ok: true, totalLiters, totalAmount, totalMoneyMeter };
    }),

  deleteShiftHistory: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const current = await db.query.shifts.findFirst({
        where: and(eq(shifts.id, input.id), eq(shifts.branchId, branchId)),
      });
      if (!current) throw new Error("ไม่พบประวัติการตัดกะ");
      if (current.status === "open") {
        throw new Error("ลบกะที่กำลังเปิดไม่ได้ กรุณาปิดกะก่อน");
      }
      await db.transaction(async tx => {
        // เก็บเอกสารการเงินจริงไว้ แต่ยกเลิกการผูกกับประวัติกะที่ถูกลบ
        await tx
          .update(sales)
          .set({ shiftId: null })
          .where(
            and(eq(sales.shiftId, current.id), eq(sales.branchId, branchId))
          );
        await tx
          .update(debtPayments)
          .set({ shiftId: null })
          .where(
            and(
              eq(debtPayments.shiftId, current.id),
              eq(debtPayments.branchId, branchId)
            )
          );
        await tx
          .update(expenses)
          .set({ shiftId: null })
          .where(
            and(
              eq(expenses.shiftId, current.id),
              eq(expenses.branchId, branchId)
            )
          );
        await tx
          .delete(shiftReadings)
          .where(
            and(
              eq(shiftReadings.shiftId, current.id),
              eq(shiftReadings.branchId, branchId)
            )
          );
        await tx
          .delete(shifts)
          .where(and(eq(shifts.id, current.id), eq(shifts.branchId, branchId)));
      });
      logAudit({
        action: "delete_shift_history",
        ...actorFromReq(ctx.req),
        detail: `ลบประวัติตัดกะ #${current.id} (${current.staffName}) โดยไม่ลบรายการขาย/รับชำระ/ค่าใช้จ่าย`,
        refType: "shift",
        refId: current.id,
      });
      return { ok: true };
    }),

  shiftDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const shift = await db.query.shifts.findFirst({
        where: and(eq(shifts.id, input.id), eq(shifts.branchId, branchId)),
      });
      if (!shift) throw new Error("ไม่พบกะ");
      const readings = await db
        .select()
        .from(shiftReadings)
        .where(
          and(
            eq(shiftReadings.shiftId, shift.id),
            eq(shiftReadings.branchId, branchId)
          )
        );
      const nozzleRows = await db.query.nozzles.findMany({
        where: (row, operators) => operators.eq(row.branchId, branchId),
      });
      const prodRows = await db.query.products.findMany({
        where: eq(products.branchId, branchId),
      });
      const saleRows = await db
        .select()
        .from(sales)
        .where(and(eq(sales.shiftId, shift.id), eq(sales.branchId, branchId)))
        .orderBy(desc(sales.createdAt));
      const priceChangeRows = await db
        .select({ productId: priceChanges.productId })
        .from(priceChanges)
        .where(
          and(
            eq(priceChanges.branchId, branchId),
            gte(priceChanges.createdAt, shift.openedAt),
            lte(priceChanges.createdAt, shift.closedAt ?? new Date())
          )
        );
      const cash = await shiftCashSummary(db, shift);
      // parse JSON การนับแบงก์/เหรียญ (กะเก่า/ข้อมูลเสีย → null)
      let cashCounts: CashCounts | null = null;
      if (shift.cashCounts) {
        try {
          cashCounts = JSON.parse(shift.cashCounts) as CashCounts;
        } catch {
          cashCounts = null;
        }
      }
      const changedProductIds = new Set(
        priceChangeRows.map(change => change.productId)
      );
      const detailReadings = readings.map(r => {
        const nz = nozzleRows.find(n => n.id === r.nozzleId);
        const prod = prodRows.find(p => p.id === nz?.productId);
        const liters =
          r.closeMeter != null ? r3(r.closeMeter - r.openMeter) : null;
        const money =
          r.closeMoney != null && r.openMoney > 0
            ? r2(r.closeMoney - r.openMoney)
            : null;
        const amountL = liters != null ? r2(liters * r.pricePerLiter) : null;
        return {
          ...r,
          nozzle: nz ?? null,
          product: prod ?? null,
          liters,
          money, // ยอดจากมิเตอร์เงิน P
          amount: amountL, // ยอดจากลิตร × ราคา
          diff: money != null && amountL != null ? r2(money - amountL) : null, // ผลต่าง P − (L×ราคา)
          priceChangedDuringShift:
            nz?.productId != null && changedProductIds.has(nz.productId),
        };
      });
      return {
        ...shift,
        cashCounts,
        cash, // สรุปเงินสด (กะเก่าที่ expectedCash เป็น null ใช้ยอดคำนวณย้อนหลังจากตัวนี้)
        sales: saleRows,
        priceChangedDuringShift: detailReadings.some(
          reading => reading.priceChangedDuringShift
        ),
        readings: detailReadings,
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
          .array(
            z.object({ productId: z.number(), qty: z.number().positive() })
          )
          .min(1),
        discount: z.number().nonnegative().default(0),
        paymentMethod: z.enum(["cash", "qr", "card", "credit"]).default("cash"),
        customerId: z.number().int().positive().optional(), // บังคับเมื่อ paymentMethod = credit
        received: z.number().nonnegative().default(0),
        pointsToRedeem: z.number().int().nonnegative().default(0),
        clientReceiptNo: z
          .string()
          .regex(/^OFF-[A-Z0-9]{6}-\d{14}-\d{4,8}$/)
          .optional(),
        clientCreatedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      if (input.shiftId != null) {
        const shift = await db.query.shifts.findFirst({
          where: and(
            eq(shifts.id, input.shiftId),
            eq(shifts.branchId, branchId),
            eq(shifts.status, "open")
          ),
          columns: { id: true },
        });
        if (!shift) throw new Error("ไม่พบกะที่เปิดอยู่ในสาขาปัจจุบัน");
      }
      if (input.clientReceiptNo) {
        const existing = await db.query.sales.findFirst({
          where: and(
            eq(sales.branchId, branchId),
            eq(sales.receiptNo, input.clientReceiptNo)
          ),
        });
        if (existing) {
          const existingItems = await db
            .select()
            .from(saleItems)
            .where(
              and(
                eq(saleItems.saleId, existing.id),
                eq(saleItems.branchId, branchId)
              )
            );
          const existingMember = existing.memberId
            ? await db.query.members.findFirst({
                where: eq(members.id, existing.memberId),
              })
            : null;
          const existingCustomer = existing.customerId
            ? await db.query.customers.findFirst({
                where: eq(customers.id, existing.customerId),
              })
            : null;
          return {
            sale: {
              ...existing,
              memberName: existingMember?.name ?? null,
              customerName: existingCustomer?.name ?? null,
            },
            items: existingItems,
          };
        }
      }
      const prodRows = await db.query.products.findMany({
        where: eq(products.branchId, branchId),
      });
      const settingMap = await getSettingMap(db, branchId);
      const vatRate = Number(settingMap.vat_rate ?? "7");
      const earnPer = Number(settingMap.point_earn_per_baht ?? "25");
      const pointValue = Number(settingMap.point_redeem_value ?? "1");

      // คำนวณราคาฝั่งเซิร์ฟเวอร์เสมอ
      const lines = input.items.map(it => {
        const p = prodRows.find(
          pr =>
            pr.id === input.items.find(x => x.productId === pr.id)?.productId &&
            pr.id === it.productId
        );
        if (!p || !p.active) throw new Error("ไม่พบสินค้าบางรายการ");
        return { product: p, qty: it.qty, amount: r2(p.price * it.qty) };
      });
      const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));

      // แลกแต้มเป็นส่วนลด
      let member: typeof members.$inferSelect | undefined;
      let redeemDiscount = 0;
      if (input.memberId) {
        member = await db.query.members.findFirst({
          where: eq(members.id, input.memberId),
        });
        if (!member) throw new Error("ไม่พบสมาชิก");
        if (input.pointsToRedeem > 0) {
          if (input.pointsToRedeem > member.points)
            throw new Error("แต้มไม่พอ");
          redeemDiscount = r2(input.pointsToRedeem * pointValue);
        }
      }
      const totalDiscount = r2(input.discount + redeemDiscount);
      if (totalDiscount > subtotal) throw new Error("ส่วนลดมากกว่ายอดขาย");

      const total = r2(subtotal - totalDiscount);
      const vatAmount = r2((total * vatRate) / (100 + vatRate)); // VAT รวมใน
      const changeAmt =
        input.paymentMethod === "cash"
          ? r2(Math.max(0, input.received - total))
          : 0;
      const pointsEarned = member ? Math.floor(total / earnPer) : 0;

      // ขายเชื่อ: บังคับเลือกลูกค้า และเช็กวงเงินเครดิต (creditLimit = 0 คือไม่จำกัด)
      let customer: typeof customers.$inferSelect | undefined;
      if (input.paymentMethod === "credit") {
        if (!input.customerId) throw new Error("ขายเชื่อต้องเลือกลูกค้า");
        customer = await db.query.customers.findFirst({
          where: eq(customers.id, input.customerId),
        });
        if (!customer) throw new Error("ไม่พบลูกค้า");
        if (customer.creditLimit > 0) {
          const outstanding = await outstandingOf(db, customer.id, branchId);
          if (r2(outstanding + total) > customer.creditLimit) {
            throw new Error(
              `เกินวงเงินเครดิตของลูกค้า (ค้างชำระ ${outstanding.toFixed(2)} บาท / วงเงิน ${customer.creditLimit.toFixed(2)} บาท)`
            );
          }
        }
      }

      const saleId = await db.transaction(async tx => {
        const receiptNo =
          input.clientReceiptNo ?? (await nextDocNo(tx, "receipt", branchId));
        const inserted = await tx
          .insert(sales)
          .values({
            branchId,
            receiptNo,
            shiftId: input.shiftId,
            staffName: input.staffName,
            memberId: input.memberId,
            customerId:
              input.paymentMethod === "credit" ? input.customerId : null,
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
            createdAt: input.clientCreatedAt,
          })
          .onConflictDoNothing({
            target: [sales.branchId, sales.receiptNo],
          })
          .returning({ id: sales.id });
        if (!inserted[0]) {
          const existing = await tx.query.sales.findFirst({
            where: and(
              eq(sales.branchId, branchId),
              eq(sales.receiptNo, receiptNo)
            ),
          });
          if (!existing) {
            throw new Error("ไม่สามารถตรวจสอบบิลออฟไลน์ที่ซ้ำได้");
          }
          return existing.id;
        }
        const id = inserted[0].id;

        await tx.insert(saleItems).values(
          lines.map(l => ({
            branchId,
            saleId: id,
            productId: l.product.id,
            name: l.product.name,
            qty: l.qty,
            unit: l.product.unit,
            unitPrice: l.product.price,
            amount: l.amount,
          }))
        );
        for (const l of lines) {
          // หักสต๊อกเฉพาะสินค้าที่ไม่ใช่น้ำมัน (น้ำมันหักผ่านมิเตอร์ตอนปิดกะ)
          if (l.product.category !== "fuel") {
            await tx
              .update(products)
              .set({ stockQty: sql`${products.stockQty} - ${l.qty}` })
              .where(
                and(
                  eq(products.id, l.product.id),
                  eq(products.branchId, branchId)
                )
              );
          }
        }

        if (member) {
          await tx
            .update(members)
            .set({
              points: sql`${members.points} - ${input.pointsToRedeem} + ${pointsEarned}`,
            })
            .where(eq(members.id, member.id));
          if (pointsEarned > 0) {
            await tx.insert(pointTransactions).values({
              branchId,
              memberId: member.id,
              saleId: id,
              type: "earn",
              points: pointsEarned,
              note: `รับแต้มจากบิล ${receiptNo}`,
            });
          }
          if (input.pointsToRedeem > 0) {
            await tx.insert(pointTransactions).values({
              branchId,
              memberId: member.id,
              saleId: id,
              type: "redeem",
              points: -input.pointsToRedeem,
              note: `ใช้แต้มลดบิล ${receiptNo}`,
            });
          }
        }
        return id;
      });

      const sale = await db.query.sales.findFirst({
        where: and(eq(sales.id, saleId), eq(sales.branchId, branchId)),
      });
      const items = await db
        .select()
        .from(saleItems)
        .where(
          and(eq(saleItems.saleId, saleId), eq(saleItems.branchId, branchId))
        );
      return {
        sale: {
          ...sale!,
          memberName: member?.name ?? null,
          customerName: customer?.name ?? null,
        },
        items,
      };
    }),

  salesHistory: publicQuery
    .input(
      z
        .object({
          q: z.string().optional(), // ค้นหา: เลขที่บิล / พนักงาน / ชื่อหรือเบอร์สมาชิก
          status: z.enum(["completed", "voided"]).optional(),
          limit: z.number().default(200),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const q = input?.q?.trim();
      const conds = [eq(sales.branchId, ctx.staff.branchId)];
      if (input?.status) conds.push(eq(sales.status, input.status));
      if (q) {
        const pattern = `%${q}%`;
        const matchedMembers = await db
          .select({ id: members.id })
          .from(members)
          .where(or(like(members.name, pattern), like(members.phone, pattern)));
        const memberIds = matchedMembers.map(m => m.id);
        const qConds = [
          like(sales.receiptNo, pattern),
          like(sales.staffName, pattern),
        ];
        if (memberIds.length > 0)
          qConds.push(inArray(sales.memberId, memberIds));
        conds.push(or(...qConds)!);
      }
      const rows = await db
        .select()
        .from(sales)
        .where(and(...conds))
        .orderBy(desc(sales.createdAt))
        .limit(input?.limit ?? 200);
      const memberRows = await db.query.members.findMany();
      return rows.map(s => ({
        ...s,
        memberName: memberRows.find(m => m.id === s.memberId)?.name ?? null,
      }));
    }),

  saleDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const sale = await db.query.sales.findFirst({
        where: and(eq(sales.id, input.id), eq(sales.branchId, branchId)),
      });
      if (!sale) throw new Error("ไม่พบบิล");
      const items = await db
        .select()
        .from(saleItems)
        .where(
          and(eq(saleItems.saleId, sale.id), eq(saleItems.branchId, branchId))
        );
      const member = sale.memberId
        ? await db.query.members.findFirst({
            where: eq(members.id, sale.memberId),
          })
        : null;
      const customer = sale.customerId
        ? await db.query.customers.findFirst({
            where: eq(customers.id, sale.customerId),
          })
        : null;
      return {
        sale,
        items,
        memberName: member?.name ?? null,
        customerName: customer?.name ?? null,
      };
    }),

  voidSale: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const sale = await db.query.sales.findFirst({
        where: and(eq(sales.id, input.id), eq(sales.branchId, branchId)),
      });
      if (!sale || sale.status === "voided") throw new Error("ยกเลิกบิลไม่ได้");
      const items = await db
        .select()
        .from(saleItems)
        .where(
          and(eq(saleItems.saleId, sale.id), eq(saleItems.branchId, branchId))
        );
      await db.transaction(async tx => {
        await tx
          .update(sales)
          .set({ status: "voided" })
          .where(and(eq(sales.id, sale.id), eq(sales.branchId, branchId)));
        // คืนสต๊อกและแต้มอัตโนมัติ
        await reverseSaleEffects(
          tx,
          sale,
          items,
          `ยกเลิกบิล ${sale.receiptNo}`
        );
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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const sale = await db.query.sales.findFirst({
        where: and(eq(sales.id, input.id), eq(sales.branchId, branchId)),
      });
      if (!sale) throw new Error("ไม่พบบิล");
      if (sale.status === "voided")
        throw new Error("แก้ไขบิลที่ยกเลิกแล้วไม่ได้");

      const discount = input.discount ?? sale.discount;
      if (discount > sale.subtotal) throw new Error("ส่วนลดมากกว่ายอดขาย");
      const paymentMethod = input.paymentMethod ?? sale.paymentMethod;
      const total = r2(sale.subtotal - discount);
      const vatAmount = r2((total * sale.vatRate) / (100 + sale.vatRate)); // VAT รวมใน
      const received = paymentMethod === "cash" ? sale.received : total;
      const changeAmt =
        paymentMethod === "cash" ? r2(Math.max(0, received - total)) : 0;

      const settingMap = await getSettingMap(db, branchId);
      const earnPer = Number(settingMap.point_earn_per_baht ?? "25");
      const pointsEarned = sale.memberId ? Math.floor(total / earnPer) : 0;

      await db.transaction(async tx => {
        await tx
          .update(sales)
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
          .where(and(eq(sales.id, sale.id), eq(sales.branchId, branchId)));
        // ปรับแต้มสมาชิกตามยอดใหม่ (เฉพาะส่วนต่าง)
        if (sale.memberId && pointsEarned !== sale.pointsEarned) {
          const diff = pointsEarned - sale.pointsEarned;
          const [m] = await tx
            .select()
            .from(members)
            .where(eq(members.id, sale.memberId!))
            .for("update");
          if (m) {
            await tx
              .update(members)
              .set({ points: m.points + diff })
              .where(eq(members.id, m.id));
            await tx.insert(pointTransactions).values({
              branchId,
              memberId: m.id,
              saleId: sale.id,
              type: "adjust",
              points: diff,
              note: `ปรับแต้มจากแก้ไขบิล ${sale.receiptNo}`,
            });
          }
        }
      });
      const changes: string[] = [];
      if (input.staffName !== undefined && input.staffName !== sale.staffName) {
        changes.push(`พนักงาน ${sale.staffName || "-"}→${input.staffName}`);
      }
      if (
        input.paymentMethod !== undefined &&
        input.paymentMethod !== sale.paymentMethod
      ) {
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
      return db.query.sales.findFirst({
        where: and(eq(sales.id, sale.id), eq(sales.branchId, branchId)),
      });
    }),

  // ลบบิลถาวร (admin/manager) — คืนสต๊อกและแต้มก่อนลบ
  deleteSale: managerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const sale = await db.query.sales.findFirst({
        where: and(eq(sales.id, input.id), eq(sales.branchId, branchId)),
      });
      if (!sale) throw new Error("ไม่พบบิล");
      const items = await db
        .select()
        .from(saleItems)
        .where(
          and(eq(saleItems.saleId, sale.id), eq(saleItems.branchId, branchId))
        );
      await db.transaction(async tx => {
        if (sale.status === "completed") {
          await reverseSaleEffects(tx, sale, items, `ลบบิล ${sale.receiptNo}`);
        }
        await tx
          .delete(taxInvoices)
          .where(
            and(
              eq(taxInvoices.saleId, sale.id),
              eq(taxInvoices.branchId, branchId)
            )
          );
        await tx
          .delete(saleItems)
          .where(
            and(eq(saleItems.saleId, sale.id), eq(saleItems.branchId, branchId))
          );
        await tx
          .delete(sales)
          .where(and(eq(sales.id, sale.id), eq(sales.branchId, branchId)));
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
  dashboard: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const now = new Date();
    const bangkokOffsetMs = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffsetMs);
    const bangkokYear = bangkokNow.getUTCFullYear();
    const bangkokMonth = bangkokNow.getUTCMonth();
    const bangkokDate = bangkokNow.getUTCDate();
    const bangkokMidnight = (dayOffset: number) =>
      new Date(
        Date.UTC(bangkokYear, bangkokMonth, bangkokDate + dayOffset) -
          bangkokOffsetMs
      );
    const startOfDay = bangkokMidnight(0);
    const chartStart = bangkokMidnight(-6);
    const endOfToday = bangkokMidnight(1);
    const saleDate = sql<string>`to_char(${sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`;

    // ทุก query เป็นอิสระต่อกัน จึงทำพร้อมกันเพื่อลด network round-trip
    const [dailyRows, fuelRows, openShift, tankRows, productRows, recent] =
      await Promise.all([
        // รวมกราฟ 7 วันและยอดวันนี้ด้วย query เดียว
        db
          .select({
            date: saleDate,
            total: sql<number>`coalesce(sum(${sales.total}), 0)`,
            bills: sql<number>`count(*)`,
          })
          .from(sales)
          .where(
            and(
              eq(sales.branchId, branchId),
              gte(sales.createdAt, chartStart),
              lt(sales.createdAt, endOfToday),
              eq(sales.status, "completed")
            )
          )
          .groupBy(saleDate),
        // รวมรายการขายกับสินค้าในฐานข้อมูล ไม่ต้องโหลดทุก row มาหาใน Node
        db
          .select({
            code: products.code,
            name: saleItems.name,
            liters: sql<number>`coalesce(sum(${saleItems.qty}), 0)`,
            amount: sql<number>`coalesce(sum(${saleItems.amount}), 0)`,
          })
          .from(saleItems)
          .innerJoin(sales, eq(saleItems.saleId, sales.id))
          .leftJoin(products, eq(saleItems.productId, products.id))
          .where(
            and(
              eq(sales.branchId, branchId),
              eq(saleItems.branchId, branchId),
              gte(sales.createdAt, startOfDay),
              lt(sales.createdAt, endOfToday),
              eq(sales.status, "completed"),
              eq(saleItems.unit, "ลิตร")
            )
          )
          .groupBy(products.code, saleItems.name),
        db.query.shifts.findFirst({
          where: and(eq(shifts.branchId, branchId), eq(shifts.status, "open")),
          orderBy: (s, { desc: d }) => [d(s.openedAt)],
        }),
        db.query.fuelTanks.findMany({
          where: eq(fuelTanks.branchId, branchId),
        }),
        db.query.products.findMany({
          where: eq(products.branchId, branchId),
        }),
        db
          .select()
          .from(sales)
          .where(eq(sales.branchId, branchId))
          .orderBy(desc(sales.createdAt))
          .limit(8),
      ]);

    const dailyByDate = new Map(dailyRows.map(row => [row.date, row]));
    const chart = Array.from({ length: 7 }, (_, index) => {
      const daysAgo = 6 - index;
      const date = new Date(
        Date.UTC(bangkokYear, bangkokMonth, bangkokDate - daysAgo)
      );
      const dateKey = date.toISOString().slice(0, 10);
      const row = dailyByDate.get(dateKey);
      return {
        date: dateKey,
        label: `${date.getUTCDate()}/${date.getUTCMonth() + 1}`,
        total: r2(Number(row?.total ?? 0)),
        bills: Number(row?.bills ?? 0),
      };
    });
    const today = dailyByDate.get(bangkokNow.toISOString().slice(0, 10));

    let litersToday = 0;
    const fuelByCode: Record<
      string,
      { name: string; liters: number; amount: number }
    > = {};
    for (const row of fuelRows) {
      const code = row.code ?? "OTHER";
      const liters = Number(row.liters);
      const amount = Number(row.amount);
      litersToday = r3(litersToday + liters);
      const current = fuelByCode[code] ?? {
        name: row.name,
        liters: 0,
        amount: 0,
      };
      current.liters = r3(current.liters + liters);
      current.amount = r2(current.amount + amount);
      fuelByCode[code] = current;
    }

    const tanks = tankRows.map(tank => ({
      ...tank,
      percent: Math.round(
        (tank.currentLiters / Math.max(tank.capacityLiters, 1)) * 100
      ),
      isLow: tank.currentLiters <= tank.lowAlertAt,
    }));
    const lowTanks = tankRows.filter(t => t.currentLiters <= t.lowAlertAt);
    const lowProducts = productRows.filter(
      product =>
        product.active &&
        product.category !== "fuel" &&
        product.stockQty <= product.lowStockAt
    );

    return {
      todayTotal: r2(Number(today?.total ?? 0)),
      todayBills: Number(today?.bills ?? 0),
      litersToday,
      fuelByCode,
      chart,
      openShift: openShift ?? null,
      tanks,
      lowTanks,
      lowProducts,
      recentSales: recent,
    };
  }),
});

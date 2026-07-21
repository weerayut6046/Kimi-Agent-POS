import { z } from "zod";
import os from "os";
import { desc, eq, ne, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { mergeSettingDefaults } from "@contracts/settings";
import {
  products,
  nozzles,
  fuelTanks,
  tankRefills,
  priceChanges,
  settings,
  shifts,
} from "@db/schema";

const TANK_DISPLAY_ORDER_KEY = "tank_display_order";

function parseTankDisplayOrder(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is number =>
            typeof id === "number" && Number.isInteger(id) && id > 0
        )
      ),
    ];
  } catch {
    return [];
  }
}

export const catalogRouter = createRouter({
  // ---------- สินค้า ----------
  listProducts: publicQuery.query(async () => {
    return getDb().query.products.findMany({
      orderBy: (p, { asc }) => [asc(p.category), asc(p.id)],
    });
  }),

  createProduct: adminQuery
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        category: z.enum(["fuel", "lubricant", "other"]),
        unit: z.string().default("ชิ้น"),
        price: z.number().nonnegative(),
        cost: z.number().nonnegative().default(0),
        stockQty: z.number().nonnegative().default(0),
        lowStockAt: z.number().nonnegative().default(0),
      })
    )
    .mutation(async ({ input }) => {
      await getDb().insert(products).values(input);
      return { ok: true };
    }),

  updateProduct: adminQuery
    .input(
      z.object({
        id: z.number(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        category: z.enum(["fuel", "lubricant", "other"]).optional(),
        unit: z.string().optional(),
        price: z.number().nonnegative().optional(),
        cost: z.number().nonnegative().optional(),
        stockQty: z.number().nonnegative().optional(),
        lowStockAt: z.number().nonnegative().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const db = getDb();
      const before = await db.query.products.findFirst({
        where: eq(products.id, id),
      });
      if (!before) throw new Error("ไม่พบสินค้า");
      const priceChanged =
        patch.price !== undefined && patch.price !== before.price;
      const nextCategory = patch.category ?? before.category;
      if (priceChanged && nextCategory === "fuel") {
        const openShift = await db.query.shifts.findFirst({
          where: eq(shifts.status, "open"),
        });
        if (openShift) {
          throw new Error(
            "ยังมีกะเปิดอยู่ กรุณาปิดกะก่อนเปลี่ยนราคาน้ำมัน แล้วเปิดกะใหม่เพื่อให้ยอดมิเตอร์ L และ P ตรงกัน"
          );
        }
      }
      await db.update(products).set(patch).where(eq(products.id, id));
      // บันทึกประวัติ + audit เฉพาะตอนราคาเปลี่ยนจริง
      if (priceChanged) {
        const actor = actorFromReq(ctx.req);
        await db.insert(priceChanges).values({
          productId: before.id,
          productCode: patch.code ?? before.code,
          productName: patch.name ?? before.name,
          oldPrice: before.price,
          newPrice: patch.price!,
          changedBy: actor.actorName,
        });
        logAudit({
          action: "update_price",
          ...actor,
          detail: `เปลี่ยนราคา ${before.code} ${before.name}: ${before.price.toFixed(2)} → ${patch.price!.toFixed(2)}`,
          refType: "product",
          refId: before.id,
        });
      }
      return { ok: true };
    }),

  deleteProduct: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // ปลอดภัยต่อประวัติขาย: sale_items เก็บชื่อ+ราคาเป็นสแนปช็อตไว้แล้ว
      await getDb().delete(products).where(eq(products.id, input.id));
      return { ok: true };
    }),

  // ประวัติเปลี่ยนราคาของสินค้า (ใหม่ → เก่า)
  priceHistory: publicQuery
    .input(z.object({ productId: z.number().int() }))
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(priceChanges)
        .where(eq(priceChanges.productId, input.productId))
        .orderBy(desc(priceChanges.createdAt), desc(priceChanges.id))
        .limit(50);
    }),

  adjustStock: adminQuery
    .input(
      z.object({
        productId: z.number(),
        qty: z.number(),
        mode: z.enum(["set", "add"]).default("add"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.products.findFirst({
        where: eq(products.id, input.productId),
      });
      if (!p) throw new Error("ไม่พบสินค้า");
      const next = input.mode === "set" ? input.qty : p.stockQty + input.qty;
      if (next < 0) throw new Error("สต๊อกติดลบไม่ได้");
      await db
        .update(products)
        .set({ stockQty: next })
        .where(eq(products.id, input.productId));
      return { ok: true, stockQty: next };
    }),

  // ---------- ตู้จ่าย / หัวจ่าย ----------
  listPumps: publicQuery.query(async () => {
    const db = getDb();
    const [pumpRows, nozzleRows, prodRows, tankRows] = await Promise.all([
      db.query.pumps.findMany(),
      db.query.nozzles.findMany(),
      db.query.products.findMany(),
      db.query.fuelTanks.findMany(),
    ]);
    return pumpRows.map(p => ({
      ...p,
      nozzles: nozzleRows
        .filter(n => n.pumpId === p.id)
        .map(n => ({
          ...n,
          product: prodRows.find(pr => pr.id === n.productId) ?? null,
          tank: tankRows.find(tank => tank.id === n.tankId) ?? null,
        })),
    }));
  }),

  updateNozzleMeter: adminQuery
    .input(
      z.object({
        id: z.number(),
        label: z.string().min(1).optional(),
        productId: z.number().optional(),
        tankId: z.number().int().positive().optional(),
        meter: z.number().nonnegative().optional(),
        money: z.number().nonnegative().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const nozzle = await db.query.nozzles.findFirst({
        where: eq(nozzles.id, input.id),
      });
      if (!nozzle) throw new Error("ไม่พบหัวจ่าย");

      const nextProductId = input.productId ?? nozzle.productId;
      const nextTankId = input.tankId ?? nozzle.tankId;
      const product = await db.query.products.findFirst({
        where: eq(products.id, nextProductId),
      });
      if (!product || product.category !== "fuel") {
        throw new Error("หัวจ่ายต้องผูกกับสินค้าประเภทน้ำมันเท่านั้น");
      }
      if (nextTankId == null) {
        throw new Error("กรุณาเลือกถังน้ำมันที่หัวจ่ายนี้จะตัดสต๊อก");
      }
      const tank = await db.query.fuelTanks.findFirst({
        where: eq(fuelTanks.id, nextTankId),
      });
      if (!tank) throw new Error("ไม่พบถังน้ำมันที่เลือก");
      if (tank.productId !== nextProductId) {
        throw new Error("ถังน้ำมันต้องเป็นชนิดเดียวกับสินค้าของหัวจ่าย");
      }

      const mappingChanged =
        nextProductId !== nozzle.productId || nextTankId !== nozzle.tankId;
      if (mappingChanged) {
        const openShift = await db.query.shifts.findFirst({
          where: eq(shifts.status, "open"),
        });
        if (openShift) {
          throw new Error("กรุณาปิดกะก่อนเปลี่ยนสินค้า/ถังน้ำมันของหัวจ่าย");
        }
      }

      const patch: Record<string, unknown> = {};
      if (input.label != null) patch.label = input.label;
      if (input.productId != null) {
        patch.productId = input.productId;
      }
      if (input.tankId != null) patch.tankId = input.tankId;
      if (input.meter != null) patch.currentMeter = input.meter;
      if (input.money != null) patch.currentMoney = input.money;
      if (input.active != null) patch.active = input.active;
      if (Object.keys(patch).length > 0) {
        await db.update(nozzles).set(patch).where(eq(nozzles.id, input.id));
      }
      return { ok: true };
    }),

  // ---------- ถังน้ำมัน ----------
  listTanks: publicQuery.query(async () => {
    const db = getDb();
    const [tankRows, prodRows, nozzleRows, savedOrder] = await Promise.all([
      db.query.fuelTanks.findMany(),
      db.query.products.findMany(),
      db.query.nozzles.findMany(),
      db.query.settings.findFirst({
        where: eq(settings.key, TANK_DISPLAY_ORDER_KEY),
      }),
    ]);
    const firstNozzleByTank = new Map<number, number>();
    for (const nozzle of nozzleRows) {
      if (nozzle.tankId == null) continue;
      const current = firstNozzleByTank.get(nozzle.tankId);
      if (current == null || nozzle.id < current) {
        firstNozzleByTank.set(nozzle.tankId, nozzle.id);
      }
    }
    const displayOrder = parseTankDisplayOrder(savedOrder?.value);
    const displayIndex = new Map(
      displayOrder.map((tankId, index) => [tankId, index])
    );
    // ใช้ลำดับที่ผู้ใช้บันทึก; ถังใหม่/ยังไม่เคยจัดเรียงต่อท้ายตามตำแหน่งหัวจ่าย
    return tankRows
      .sort((a, b) => {
        const savedA = displayIndex.get(a.id);
        const savedB = displayIndex.get(b.id);
        if (savedA != null && savedB != null) return savedA - savedB;
        if (savedA != null) return -1;
        if (savedB != null) return 1;
        return (
          (firstNozzleByTank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (firstNozzleByTank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          a.id - b.id
        );
      })
      .map(t => ({
        ...t,
        product: prodRows.find(p => p.id === t.productId) ?? null,
        percent: Math.round((t.currentLiters / t.capacityLiters) * 100),
        isLow: t.currentLiters <= t.lowAlertAt,
      }));
  }),

  reorderTanks: adminQuery
    .input(
      z.object({
        tankIds: z.array(z.number().int().positive()).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tankIds = [...new Set(input.tankIds)];
      if (tankIds.length !== input.tankIds.length) {
        throw new Error("ลำดับถังมีรายการซ้ำ กรุณาลองใหม่");
      }

      const db = getDb();
      const currentTanks = await db.query.fuelTanks.findMany({
        columns: { id: true },
      });
      const currentIds = new Set(currentTanks.map(tank => tank.id));
      if (
        tankIds.length !== currentIds.size ||
        tankIds.some(tankId => !currentIds.has(tankId))
      ) {
        throw new Error("รายการถังมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่");
      }

      await db
        .insert(settings)
        .values({
          key: TANK_DISPLAY_ORDER_KEY,
          value: JSON.stringify(tankIds),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: JSON.stringify(tankIds) },
        });
      logAudit({
        action: "reorder_tanks",
        ...actorFromReq(ctx.req),
        detail: `จัดลำดับถังน้ำมัน: ${tankIds.join(" → ")}`,
        refType: "fuel_tank",
      });
      return { ok: true, tankIds };
    }),

  // รายการแจ้งเตือนสต็อกต่ำ: ถังน้ำมันใกล้หมด + สินค้า (ไม่ใช่น้ำมัน) ต่ำกว่าเกณฑ์
  // ใช้โดยกระดิ่งแจ้งเตือนใน Layout ที่โพลเป็นระยะ — เงื่อนไขต้องตรงกับ pos.dashboard
  lowStockAlerts: publicQuery.query(async () => {
    const db = getDb();
    const [tankRows, prodRows] = await Promise.all([
      db.query.fuelTanks.findMany(),
      db.query.products.findMany(),
    ]);
    const lowTanks = tankRows
      .filter(t => t.currentLiters <= t.lowAlertAt)
      .map(t => ({
        id: t.id,
        name: t.name,
        currentLiters: t.currentLiters,
        capacityLiters: t.capacityLiters,
        lowAlertAt: t.lowAlertAt,
      }));
    const lowProducts = prodRows
      .filter(
        p => p.active && p.category !== "fuel" && p.stockQty <= p.lowStockAt
      )
      .map(p => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        stockQty: p.stockQty,
        lowStockAt: p.lowStockAt,
      }));
    return {
      lowTanks,
      lowProducts,
      count: lowTanks.length + lowProducts.length,
    };
  }),

  createTank: adminQuery
    .input(
      z.object({
        productId: z.number(),
        name: z.string().min(1),
        capacityLiters: z.number().positive(),
        currentLiters: z.number().nonnegative().default(0),
        lowAlertAt: z.number().nonnegative().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const product = await db.query.products.findFirst({
        where: eq(products.id, input.productId),
      });
      if (!product || product.category !== "fuel") {
        throw new Error("ต้องผูกถังกับสินค้าประเภทน้ำมัน (fuel) เท่านั้น");
      }
      if (input.currentLiters > input.capacityLiters)
        throw new Error("ระดับน้ำมันเกินความจุถัง");
      await db.insert(fuelTanks).values(input);
      return { ok: true };
    }),

  deleteTank: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const tank = await db.query.fuelTanks.findFirst({
        where: eq(fuelTanks.id, input.id),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      const linkedNozzle = await db.query.nozzles.findFirst({
        where: eq(nozzles.tankId, input.id),
      });
      if (linkedNozzle) {
        throw new Error(
          "ถังนี้ยังผูกกับหัวจ่ายอยู่ กรุณาเปลี่ยนถังของหัวจ่ายก่อนลบ"
        );
      }
      // tank_refills ไม่ได้เก็บ snapshot ชื่อถัง — ลบประวัติรับเข้าของถังนี้ไปพร้อมกัน
      await db.transaction(async tx => {
        await tx.delete(tankRefills).where(eq(tankRefills.tankId, input.id));
        await tx.delete(fuelTanks).where(eq(fuelTanks.id, input.id));
      });
      return { ok: true };
    }),

  // ปรับระดับน้ำมันในถังโดยตรง (admin) — ใช้แก้ค่าคลาดเคลื่อน/หลังสอบเทียบถัง
  updateTank: adminQuery
    .input(
      z.object({
        id: z.number(),
        productId: z.number().int().positive().optional(),
        name: z.string().min(1).optional(),
        currentLiters: z.number().nonnegative().optional(),
        capacityLiters: z.number().positive().optional(),
        lowAlertAt: z.number().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const db = getDb();
      const tank = await db.query.fuelTanks.findFirst({
        where: eq(fuelTanks.id, id),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      if (patch.productId !== undefined && patch.productId !== tank.productId) {
        const product = await db.query.products.findFirst({
          where: eq(products.id, patch.productId),
        });
        if (!product || product.category !== "fuel") {
          throw new Error("ถังต้องผูกกับสินค้าประเภทน้ำมันเท่านั้น");
        }
        const linkedNozzle = await db.query.nozzles.findFirst({
          where: eq(nozzles.tankId, id),
        });
        if (linkedNozzle) {
          throw new Error(
            "ถังนี้ยังผูกกับหัวจ่ายอยู่ กรุณาเปลี่ยนถังของหัวจ่ายก่อนเปลี่ยนชนิดน้ำมัน"
          );
        }
      }
      const nextCap = patch.capacityLiters ?? tank.capacityLiters;
      const nextCur = patch.currentLiters ?? tank.currentLiters;
      if (nextCur > nextCap) throw new Error("ระดับน้ำมันเกินความจุถัง");
      await db.update(fuelTanks).set(patch).where(eq(fuelTanks.id, id));
      return { ok: true };
    }),

  refillTank: publicQuery
    .input(
      z.object({
        tankId: z.number(),
        liters: z.number().positive(),
        costPerLiter: z.number().nonnegative().default(0),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const tank = await db.query.fuelTanks.findFirst({
        where: eq(fuelTanks.id, input.tankId),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      const next = tank.currentLiters + input.liters;
      if (next > tank.capacityLiters) throw new Error("เกินความจุถัง");
      await db.transaction(async tx => {
        await tx.insert(tankRefills).values(input);
        await tx
          .update(fuelTanks)
          .set({ currentLiters: next })
          .where(eq(fuelTanks.id, input.tankId));
      });
      return { ok: true, currentLiters: next };
    }),

  listRefills: publicQuery.query(async () => {
    const db = getDb();
    const [rows, tankRows] = await Promise.all([
      db
        .select()
        .from(tankRefills)
        .orderBy(desc(tankRefills.createdAt))
        .limit(30),
      db.query.fuelTanks.findMany(),
    ]);
    return rows.map(r => ({
      ...r,
      tank: tankRows.find(t => t.id === r.tankId) ?? null,
    }));
  }),

  // ---------- ตั้งค่า ----------
  getSettings: publicQuery.query(async () => {
    // ตัด shop_logo ออก — ขนาดใหญ่ ดึงเฉพาะจุดผ่าน getShopLogo
    const rows = await getDb()
      .select()
      .from(settings)
      .where(ne(settings.key, "shop_logo"));
    return mergeSettingDefaults(rows.map(r => [r.key, r.value] as const));
  }),

  getShopLogo: publicQuery.query(async () => {
    const row = await getDb().query.settings.findFirst({
      where: eq(settings.key, "shop_logo"),
    });
    return row?.value || null;
  }),

  // ข้อมูลสำหรับเชื่อมต่อจากเครื่องอื่นใน LAN (multi-station) — urls คืนเสมอให้หน้า Settings preview ได้
  // ส่วนหน้า Login จะแสดงเฉพาะตอน enabled (เปิดใน Settings แล้วรีสตาร์ทแอป)
  lanInfo: publicQuery.query(async () => {
    const db = getDb();
    let enabled = false;
    try {
      const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "lan_enabled"));
      enabled = row?.value === "1";
    } catch {
      // ตาราง settings ยังไม่พร้อม — ถือว่าปิด
    }
    const port = parseInt(process.env.PORT || "3000");
    const urls: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        // family อาจเป็น "IPv4" (string) หรือ 4 (number) แล้วแต่ runtime — รองรับทั้งสองรูปแบบ
        const fam = String(info.family);
        if ((fam === "IPv4" || fam === "4") && !info.internal) {
          urls.push(`http://${info.address}:${port}`);
        }
      }
    }
    return { enabled, port, urls };
  }),

  updateSettings: adminQuery
    .input(
      z.object({
        entries: z.array(
          z.object({ key: z.string().min(1), value: z.string() })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      // ตัด key ซ้ำโดยให้ค่าตัวท้ายสุดชนะ แล้วเขียนทั้งหมดใน transaction เดียว
      const entries = [
        ...new Map(input.entries.map(entry => [entry.key, entry.value])),
      ].map(([key, value]) => ({ key, value }));
      if (entries.length > 0) {
        await db
          .insert(settings)
          .values(entries)
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: sql`excluded.value` },
          });
      }

      // อ่านกลับจากฐานข้อมูลจริงให้ client ใช้เป็น source of truth ทันทีหลังบันทึก
      const rows = await db
        .select()
        .from(settings)
        .where(ne(settings.key, "shop_logo"));
      return {
        ok: true,
        settings: mergeSettingDefaults(
          rows.map(r => [r.key, r.value] as const)
        ),
      };
    }),
});

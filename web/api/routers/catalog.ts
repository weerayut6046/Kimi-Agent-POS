import { z } from "zod";
import { and, desc, eq, ilike, ne, sql } from "drizzle-orm";
import { anonymousQuery, createRouter, publicQuery } from "../middleware";
import { adminQuery, managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { lookupExternalProduct } from "../lib/externalProductLookup";
import { persistExternalProductImage } from "../lib/productImageStorage";
import { mergeSettingDefaults } from "@contracts/settings";
import {
  billPromotionSettingsValidationMessage,
  promotionSettingsValidationMessage,
} from "@contracts/promotion";
import { getLanUrls, isPublicCloudRuntime } from "../lib/lan";
import {
  products,
  pumps,
  nozzles,
  fuelTanks,
  tankRefills,
  tankReadings,
  priceChanges,
  settings,
  shifts,
  shiftReadings,
} from "@db/schema";

const TANK_DISPLAY_ORDER_KEY = "tank_display_order";
const PRODUCT_DISPLAY_ORDER_KEY = "product_display_order";

function parseDisplayOrder(value: string | null | undefined): number[] {
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

function duplicateProductError(active: boolean): Error {
  return new Error(
    active
      ? "สินค้านี้มีอยู่ในสาขาแล้ว กรุณายิงบาร์โค้ดอีกครั้ง"
      : "สินค้านี้มีอยู่แล้วแต่ถูกปิดการขาย กรุณาให้ผู้ดูแลเปิดใช้งาน"
  );
}

export const catalogRouter = createRouter({
  // ---------- สินค้า ----------
  listProducts: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [rows, savedOrder] = await Promise.all([
      db.query.products.findMany({
        where: eq(products.branchId, ctx.staff.branchId),
        orderBy: (p, { asc }) => [asc(p.category), asc(p.id)],
      }),
      db.query.settings.findFirst({
        where: and(
          eq(settings.branchId, ctx.staff.branchId),
          eq(settings.key, PRODUCT_DISPLAY_ORDER_KEY)
        ),
      }),
    ]);
    const displayIndex = new Map(
      parseDisplayOrder(savedOrder?.value).map((productId, index) => [
        productId,
        index,
      ])
    );
    const defaultIndex = new Map(
      rows.map((product, index) => [product.id, index])
    );
    rows.sort((a, b) => {
      const savedA = displayIndex.get(a.id);
      const savedB = displayIndex.get(b.id);
      if (savedA != null && savedB != null) return savedA - savedB;
      if (savedA != null) return -1;
      if (savedB != null) return 1;
      return (defaultIndex.get(a.id) ?? 0) - (defaultIndex.get(b.id) ?? 0);
    });
    return ctx.staff.role === "cashier"
      ? rows.map(product => ({ ...product, cost: 0 }))
      : rows;
  }),

  searchExternalProduct: publicQuery
    .input(
      z.object({
        barcode: z
          .string()
          .trim()
          .regex(/^\d{8,14}$/, {
            message: "บาร์โค้ดสำหรับค้นหาออนไลน์ต้องเป็นตัวเลข 8–14 หลัก",
          }),
      })
    )
    .query(({ input }) => lookupExternalProduct(input.barcode)),

  importExternalProduct: publicQuery
    .input(
      z.object({
        barcode: z
          .string()
          .trim()
          .regex(/^\d{8,14}$/),
        name: z.string().trim().min(1).max(200),
        category: z.enum(["lubricant", "other"]).default("other"),
        unit: z.string().trim().min(1).max(30).default("ชิ้น"),
        price: z.number().min(0.01).max(10_000_000),
        cost: z.number().nonnegative().max(10_000_000).default(0),
        stockQty: z.number().min(1).max(1_000_000),
        lowStockAt: z.number().nonnegative().max(1_000_000).default(0),
        imageUrl: z.string().url().max(2_048).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existingBeforeUpload = await db.query.products.findFirst({
        where: and(
          eq(products.branchId, ctx.staff.branchId),
          ilike(products.code, input.barcode)
        ),
        columns: { active: true },
      });
      if (existingBeforeUpload) {
        throw duplicateProductError(existingBeforeUpload.active);
      }

      // Download outside the DB transaction so a slow image host never keeps
      // row/table locks open. The helper falls back to the validated source URL.
      const imageUrl = await persistExternalProductImage({
        imageUrl: input.imageUrl,
        branchId: ctx.staff.branchId,
        barcode: input.barcode,
      });
      const created = await db.transaction(async tx => {
        const existing = await tx.query.products.findFirst({
          where: and(
            eq(products.branchId, ctx.staff.branchId),
            ilike(products.code, input.barcode)
          ),
          columns: { id: true, active: true },
        });
        if (existing) {
          throw duplicateProductError(existing.active);
        }

        const [inserted] = await tx
          .insert(products)
          .values({
            branchId: ctx.staff.branchId,
            code: input.barcode,
            name: input.name,
            imageUrl,
            category: input.category,
            unit: input.unit,
            price: input.price,
            cost: ctx.staff.role === "cashier" ? 0 : input.cost,
            stockQty: input.stockQty,
            lowStockAt: input.lowStockAt,
            active: true,
          })
          .returning();
        if (!inserted) throw new Error("เพิ่มสินค้าเข้าระบบไม่สำเร็จ");
        return inserted;
      });

      const actor = actorFromReq(ctx.req);
      logAudit({
        action: "import_product_from_external_catalog",
        ...actor,
        detail: `เพิ่มสินค้าจาก Open Facts ${created.code} ${created.name} ราคา ${created.price.toFixed(2)} บาท สต๊อกเริ่มต้น ${input.stockQty} ${created.unit}`,
        refType: "product",
        refId: created.id,
      });

      return ctx.staff.role === "cashier" ? { ...created, cost: 0 } : created;
    }),

  reorderProducts: adminQuery
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const productIds = [...new Set(input.productIds)];
      if (productIds.length !== input.productIds.length) {
        throw new Error("ลำดับสินค้ามีรายการซ้ำ กรุณาลองใหม่");
      }

      const db = getDb();
      const currentProducts = await db.query.products.findMany({
        where: eq(products.branchId, ctx.staff.branchId),
        columns: { id: true },
      });
      const currentIds = new Set(currentProducts.map(product => product.id));
      if (
        productIds.length !== currentIds.size ||
        productIds.some(productId => !currentIds.has(productId))
      ) {
        throw new Error("รายการสินค้ามีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่");
      }

      await db
        .insert(settings)
        .values({
          branchId: ctx.staff.branchId,
          key: PRODUCT_DISPLAY_ORDER_KEY,
          value: JSON.stringify(productIds),
        })
        .onConflictDoUpdate({
          target: [settings.branchId, settings.key],
          set: { value: JSON.stringify(productIds) },
        });
      logAudit({
        action: "reorder_products",
        ...actorFromReq(ctx.req),
        detail: `จัดลำดับสินค้า: ${productIds.join(" → ")}`,
        refType: "product",
      });
      return { ok: true, productIds };
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
    .mutation(async ({ input, ctx }) => {
      await getDb()
        .insert(products)
        .values({ ...input, branchId: ctx.staff.branchId });
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
        where: and(
          eq(products.id, id),
          eq(products.branchId, ctx.staff.branchId)
        ),
      });
      if (!before) throw new Error("ไม่พบสินค้า");
      const priceChanged =
        patch.price !== undefined && patch.price !== before.price;
      await db
        .update(products)
        .set(patch)
        .where(
          and(eq(products.id, id), eq(products.branchId, ctx.staff.branchId))
        );
      // บันทึกประวัติ + audit เฉพาะตอนราคาเปลี่ยนจริง
      if (priceChanged) {
        const actor = actorFromReq(ctx.req);
        await db.insert(priceChanges).values({
          branchId: ctx.staff.branchId,
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
    .mutation(async ({ input, ctx }) => {
      // ปลอดภัยต่อประวัติขาย: sale_items เก็บชื่อ+ราคาเป็นสแนปช็อตไว้แล้ว
      await getDb()
        .delete(products)
        .where(
          and(
            eq(products.id, input.id),
            eq(products.branchId, ctx.staff.branchId)
          )
        );
      return { ok: true };
    }),

  // ประวัติเปลี่ยนราคาของสินค้า (ใหม่ → เก่า)
  priceHistory: publicQuery
    .input(z.object({ productId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      return getDb()
        .select()
        .from(priceChanges)
        .where(
          and(
            eq(priceChanges.productId, input.productId),
            eq(priceChanges.branchId, ctx.staff.branchId)
          )
        )
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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const p = await db.query.products.findFirst({
        where: and(
          eq(products.id, input.productId),
          eq(products.branchId, ctx.staff.branchId)
        ),
      });
      if (!p) throw new Error("ไม่พบสินค้า");
      const next = input.mode === "set" ? input.qty : p.stockQty + input.qty;
      if (next < 0) throw new Error("สต๊อกติดลบไม่ได้");
      await db
        .update(products)
        .set({ stockQty: next })
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.branchId, ctx.staff.branchId)
          )
        );
      return { ok: true, stockQty: next };
    }),

  // ---------- ตู้จ่าย / หัวจ่าย ----------
  listPumps: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [pumpRows, nozzleRows, prodRows, tankRows] = await Promise.all([
      db.query.pumps.findMany({
        where: eq(pumps.branchId, branchId),
        orderBy: (row, { asc }) => [asc(row.id)],
      }),
      db.query.nozzles.findMany({
        where: eq(nozzles.branchId, branchId),
        orderBy: (row, { asc }) => [asc(row.id)],
      }),
      db.query.products.findMany({ where: eq(products.branchId, branchId) }),
      db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      }),
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

  createPump: adminQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [pump] = await getDb()
        .insert(pumps)
        .values({
          branchId: ctx.staff.branchId,
          name: input.name,
        })
        .returning();
      logAudit({
        action: "create_pump",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มตู้จ่าย ${input.name}`,
        refType: "pump",
        refId: pump?.id,
      });
      return { ok: true, pump };
    }),

  updatePump: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const pump = await db.query.pumps.findFirst({
        where: and(eq(pumps.id, input.id), eq(pumps.branchId, branchId)),
      });
      if (!pump) throw new Error("ไม่พบตู้จ่าย");
      await db
        .update(pumps)
        .set({ name: input.name })
        .where(and(eq(pumps.id, input.id), eq(pumps.branchId, branchId)));
      logAudit({
        action: "update_pump",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขตู้จ่าย ${pump.name} เป็น ${input.name}`,
        refType: "pump",
        refId: pump.id,
      });
      return { ok: true };
    }),

  deletePump: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const pump = await db.query.pumps.findFirst({
        where: and(eq(pumps.id, input.id), eq(pumps.branchId, branchId)),
      });
      if (!pump) throw new Error("ไม่พบตู้จ่าย");
      const linkedNozzle = await db.query.nozzles.findFirst({
        where: and(
          eq(nozzles.pumpId, input.id),
          eq(nozzles.branchId, branchId)
        ),
      });
      if (linkedNozzle) {
        throw new Error("ตู้จ่ายนี้ยังมีหัวจ่ายอยู่ กรุณาลบหัวจ่ายก่อน");
      }
      await db
        .delete(pumps)
        .where(and(eq(pumps.id, input.id), eq(pumps.branchId, branchId)));
      logAudit({
        action: "delete_pump",
        ...actorFromReq(ctx.req),
        detail: `ลบตู้จ่าย ${pump.name}`,
        refType: "pump",
        refId: pump.id,
      });
      return { ok: true };
    }),

  createNozzle: adminQuery
    .input(
      z.object({
        pumpId: z.number().int().positive(),
        productId: z.number().int().positive(),
        tankId: z.number().int().positive(),
        label: z.string().trim().min(1).max(100),
        meter: z.number().nonnegative().default(0),
        money: z.number().nonnegative().default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const [pump, product, tank, openShift] = await Promise.all([
        db.query.pumps.findFirst({
          where: and(eq(pumps.id, input.pumpId), eq(pumps.branchId, branchId)),
        }),
        db.query.products.findFirst({
          where: and(
            eq(products.id, input.productId),
            eq(products.branchId, branchId)
          ),
        }),
        db.query.fuelTanks.findFirst({
          where: and(
            eq(fuelTanks.id, input.tankId),
            eq(fuelTanks.branchId, branchId)
          ),
        }),
        db.query.shifts.findFirst({
          where: and(eq(shifts.status, "open"), eq(shifts.branchId, branchId)),
        }),
      ]);
      if (!pump) throw new Error("ไม่พบตู้จ่าย");
      if (!product || product.category !== "fuel") {
        throw new Error("หัวจ่ายต้องผูกกับสินค้าประเภทน้ำมันเท่านั้น");
      }
      if (!tank) throw new Error("ไม่พบถังน้ำมันที่เลือก");
      if (tank.productId !== product.id) {
        throw new Error("ถังน้ำมันต้องเป็นชนิดเดียวกับสินค้าของหัวจ่าย");
      }
      if (openShift) {
        throw new Error("กรุณาปิดกะก่อนเพิ่มหัวจ่าย");
      }

      const [nozzle] = await db
        .insert(nozzles)
        .values({
          branchId,
          pumpId: pump.id,
          productId: product.id,
          tankId: tank.id,
          label: input.label,
          currentMeter: input.meter,
          currentMoney: input.money,
        })
        .returning();
      logAudit({
        action: "create_nozzle",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มหัวจ่าย ${input.label} ใน ${pump.name}`,
        refType: "nozzle",
        refId: nozzle?.id,
      });
      return { ok: true, nozzle };
    }),

  updateNozzleMeter: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        pumpId: z.number().int().positive().optional(),
        label: z.string().trim().min(1).max(100).optional(),
        productId: z.number().int().positive().optional(),
        tankId: z.number().int().positive().optional(),
        meter: z.number().nonnegative().optional(),
        money: z.number().nonnegative().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const nozzle = await db.query.nozzles.findFirst({
        where: and(eq(nozzles.id, input.id), eq(nozzles.branchId, branchId)),
      });
      if (!nozzle) throw new Error("ไม่พบหัวจ่าย");

      const nextPumpId = input.pumpId ?? nozzle.pumpId;
      const nextProductId = input.productId ?? nozzle.productId;
      const nextTankId = input.tankId ?? nozzle.tankId;
      const [pump, product] = await Promise.all([
        db.query.pumps.findFirst({
          where: and(eq(pumps.id, nextPumpId), eq(pumps.branchId, branchId)),
        }),
        db.query.products.findFirst({
          where: and(
            eq(products.id, nextProductId),
            eq(products.branchId, branchId)
          ),
        }),
      ]);
      if (!pump) throw new Error("ไม่พบตู้จ่าย");
      if (!product || product.category !== "fuel") {
        throw new Error("หัวจ่ายต้องผูกกับสินค้าประเภทน้ำมันเท่านั้น");
      }
      if (nextTankId == null) {
        throw new Error("กรุณาเลือกถังน้ำมันที่หัวจ่ายนี้จะตัดสต๊อก");
      }
      const tank = await db.query.fuelTanks.findFirst({
        where: and(
          eq(fuelTanks.id, nextTankId),
          eq(fuelTanks.branchId, branchId)
        ),
      });
      if (!tank) throw new Error("ไม่พบถังน้ำมันที่เลือก");
      if (tank.productId !== nextProductId) {
        throw new Error("ถังน้ำมันต้องเป็นชนิดเดียวกับสินค้าของหัวจ่าย");
      }

      const mappingChanged =
        nextPumpId !== nozzle.pumpId ||
        nextProductId !== nozzle.productId ||
        nextTankId !== nozzle.tankId;
      if (mappingChanged) {
        const openShift = await db.query.shifts.findFirst({
          where: and(eq(shifts.status, "open"), eq(shifts.branchId, branchId)),
        });
        if (openShift) {
          throw new Error(
            "กรุณาปิดกะก่อนเปลี่ยนสินค้า/ถังน้ำมันหรือย้ายตู้จ่ายของหัวจ่าย"
          );
        }
      }

      const patch: Record<string, unknown> = {};
      if (input.pumpId != null) patch.pumpId = input.pumpId;
      if (input.label != null) patch.label = input.label;
      if (input.productId != null) {
        patch.productId = input.productId;
      }
      if (input.tankId != null) patch.tankId = input.tankId;
      if (input.meter != null) patch.currentMeter = input.meter;
      if (input.money != null) patch.currentMoney = input.money;
      if (input.active != null) patch.active = input.active;
      if (Object.keys(patch).length > 0) {
        await db
          .update(nozzles)
          .set(patch)
          .where(and(eq(nozzles.id, input.id), eq(nozzles.branchId, branchId)));
      }
      logAudit({
        action: "update_nozzle",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขหัวจ่าย ${input.label ?? nozzle.label}`,
        refType: "nozzle",
        refId: nozzle.id,
      });
      return { ok: true };
    }),

  deleteNozzle: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const nozzle = await db.query.nozzles.findFirst({
        where: and(eq(nozzles.id, input.id), eq(nozzles.branchId, branchId)),
      });
      if (!nozzle) throw new Error("ไม่พบหัวจ่าย");
      const [openShift, historicalReading] = await Promise.all([
        db.query.shifts.findFirst({
          where: and(eq(shifts.status, "open"), eq(shifts.branchId, branchId)),
        }),
        db.query.shiftReadings.findFirst({
          where: and(
            eq(shiftReadings.nozzleId, input.id),
            eq(shiftReadings.branchId, branchId)
          ),
        }),
      ]);
      if (openShift) {
        throw new Error("กรุณาปิดกะก่อนลบหัวจ่าย");
      }
      if (historicalReading) {
        throw new Error(
          "หัวจ่ายนี้มีประวัติกะแล้ว จึงลบไม่ได้ เพื่อรักษาความถูกต้องของรายงาน"
        );
      }
      await db
        .delete(nozzles)
        .where(and(eq(nozzles.id, input.id), eq(nozzles.branchId, branchId)));
      logAudit({
        action: "delete_nozzle",
        ...actorFromReq(ctx.req),
        detail: `ลบหัวจ่าย ${nozzle.label}`,
        refType: "nozzle",
        refId: nozzle.id,
      });
      return { ok: true };
    }),

  // ---------- ถังน้ำมัน ----------
  listTanks: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [tankRows, prodRows, nozzleRows, savedOrder] = await Promise.all([
      db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      }),
      db.query.products.findMany({ where: eq(products.branchId, branchId) }),
      db.query.nozzles.findMany({ where: eq(nozzles.branchId, branchId) }),
      db.query.settings.findFirst({
        where: and(
          eq(settings.branchId, branchId),
          eq(settings.key, TANK_DISPLAY_ORDER_KEY)
        ),
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
    const displayOrder = parseDisplayOrder(savedOrder?.value);
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
        where: eq(fuelTanks.branchId, ctx.staff.branchId),
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
          branchId: ctx.staff.branchId,
          key: TANK_DISPLAY_ORDER_KEY,
          value: JSON.stringify(tankIds),
        })
        .onConflictDoUpdate({
          target: [settings.branchId, settings.key],
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
  lowStockAlerts: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [tankRows, prodRows] = await Promise.all([
      db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      }),
      db.query.products.findMany({ where: eq(products.branchId, branchId) }),
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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.id, input.productId),
          eq(products.branchId, ctx.staff.branchId)
        ),
      });
      if (!product || product.category !== "fuel") {
        throw new Error("ต้องผูกถังกับสินค้าประเภทน้ำมัน (fuel) เท่านั้น");
      }
      if (input.currentLiters > input.capacityLiters)
        throw new Error("ระดับน้ำมันเกินความจุถัง");
      await db
        .insert(fuelTanks)
        .values({ ...input, branchId: ctx.staff.branchId });
      return { ok: true };
    }),

  deleteTank: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const tank = await db.query.fuelTanks.findFirst({
        where: and(
          eq(fuelTanks.id, input.id),
          eq(fuelTanks.branchId, branchId)
        ),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      const linkedNozzle = await db.query.nozzles.findFirst({
        where: and(
          eq(nozzles.tankId, input.id),
          eq(nozzles.branchId, branchId)
        ),
      });
      if (linkedNozzle) {
        throw new Error(
          "ถังนี้ยังผูกกับหัวจ่ายอยู่ กรุณาเปลี่ยนถังของหัวจ่ายก่อนลบ"
        );
      }
      // tank_refills ไม่ได้เก็บ snapshot ชื่อถัง — ลบประวัติรับเข้าของถังนี้ไปพร้อมกัน
      await db.transaction(async tx => {
        await tx
          .delete(tankRefills)
          .where(
            and(
              eq(tankRefills.tankId, input.id),
              eq(tankRefills.branchId, branchId)
            )
          );
        await tx
          .delete(fuelTanks)
          .where(
            and(eq(fuelTanks.id, input.id), eq(fuelTanks.branchId, branchId))
          );
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
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const tank = await db.query.fuelTanks.findFirst({
        where: and(eq(fuelTanks.id, id), eq(fuelTanks.branchId, branchId)),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      if (patch.productId !== undefined && patch.productId !== tank.productId) {
        const product = await db.query.products.findFirst({
          where: and(
            eq(products.id, patch.productId),
            eq(products.branchId, branchId)
          ),
        });
        if (!product || product.category !== "fuel") {
          throw new Error("ถังต้องผูกกับสินค้าประเภทน้ำมันเท่านั้น");
        }
        const linkedNozzle = await db.query.nozzles.findFirst({
          where: and(eq(nozzles.tankId, id), eq(nozzles.branchId, branchId)),
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
      await db
        .update(fuelTanks)
        .set(patch)
        .where(and(eq(fuelTanks.id, id), eq(fuelTanks.branchId, branchId)));
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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const tank = await db.query.fuelTanks.findFirst({
        where: and(
          eq(fuelTanks.id, input.tankId),
          eq(fuelTanks.branchId, branchId)
        ),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      const next = tank.currentLiters + input.liters;
      if (next > tank.capacityLiters) throw new Error("เกินความจุถัง");
      await db.transaction(async tx => {
        await tx.insert(tankRefills).values({ ...input, branchId });
        await tx
          .update(fuelTanks)
          .set({ currentLiters: next })
          .where(
            and(
              eq(fuelTanks.id, input.tankId),
              eq(fuelTanks.branchId, branchId)
            )
          );
        await tx
          .update(products)
          .set({ cost: input.costPerLiter })
          .where(
            and(
              eq(products.id, tank.productId),
              eq(products.branchId, branchId)
            )
          );
      });
      return { ok: true, currentLiters: next };
    }),

  listRefills: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [rows, tankRows] = await Promise.all([
      db
        .select()
        .from(tankRefills)
        .where(eq(tankRefills.branchId, branchId))
        .orderBy(desc(tankRefills.createdAt))
        .limit(30),
      db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      }),
    ]);
    return rows.map(r => ({
      ...r,
      tank: tankRows.find(t => t.id === r.tankId) ?? null,
    }));
  }),

  // ---------- ค่าวัดระดับถังจริง (กระทบยอด) ----------
  addTankReading: publicQuery
    .input(
      z.object({
        tankId: z.number(),
        liters: z.number().nonnegative(),
        note: z.string().optional(),
        adjustStock: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const tank = await db.query.fuelTanks.findFirst({
        where: and(
          eq(fuelTanks.id, input.tankId),
          eq(fuelTanks.branchId, branchId)
        ),
      });
      if (!tank) throw new Error("ไม่พบถัง");
      if (input.adjustStock && input.liters > tank.capacityLiters)
        throw new Error("ค่าที่วัดเกินความจุถัง");
      const actor = actorFromReq(ctx.req);
      await db.transaction(async tx => {
        await tx.insert(tankReadings).values({
          branchId,
          tankId: input.tankId,
          liters: input.liters,
          staffId: actor.actorId,
          staffName: actor.actorName,
          note: input.note,
        });
        if (input.adjustStock) {
          await tx
            .update(fuelTanks)
            .set({ currentLiters: input.liters })
            .where(
              and(
                eq(fuelTanks.id, input.tankId),
                eq(fuelTanks.branchId, branchId)
              )
            );
        }
      });
      logAudit({
        action: "tank.reading",
        ...actor,
        detail:
          `วัดระดับ ${tank.name}: ${input.liters.toLocaleString("th-TH")} ลิตร` +
          (input.adjustStock
            ? ` (ปรับยอดสต็อกจาก ${tank.currentLiters.toLocaleString("th-TH")} → ${input.liters.toLocaleString("th-TH")} ลิตร)`
            : ""),
        refType: "fuel_tank",
        refId: tank.id,
      });
      return {
        ok: true,
        currentLiters: input.adjustStock ? input.liters : tank.currentLiters,
      };
    }),

  listTankReadings: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [rows, tankRows] = await Promise.all([
      db
        .select()
        .from(tankReadings)
        .where(eq(tankReadings.branchId, branchId))
        .orderBy(desc(tankReadings.measuredAt))
        .limit(30),
      db.query.fuelTanks.findMany({
        where: eq(fuelTanks.branchId, branchId),
      }),
    ]);
    return rows.map(r => ({
      ...r,
      tank: tankRows.find(t => t.id === r.tankId) ?? null,
    }));
  }),

  deleteTankReading: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const reading = await db.query.tankReadings.findFirst({
        where: and(
          eq(tankReadings.id, input.id),
          eq(tankReadings.branchId, branchId)
        ),
      });
      if (!reading) throw new Error("ไม่พบรายการวัด");
      await db
        .delete(tankReadings)
        .where(
          and(
            eq(tankReadings.id, input.id),
            eq(tankReadings.branchId, branchId)
          )
        );
      logAudit({
        action: "tank.reading.delete",
        ...actorFromReq(ctx.req),
        detail: `ลบค่าวัดถัง #${reading.id}: ${reading.liters.toLocaleString("th-TH")} ลิตร เมื่อ ${reading.measuredAt.toISOString()}`,
        refType: "tank_reading",
        refId: reading.id,
      });
      return { ok: true };
    }),

  // ---------- ตั้งค่า ----------
  getSettings: publicQuery.query(async ({ ctx }) => {
    // ตัด shop_logo ออก — ขนาดใหญ่ ดึงเฉพาะจุดผ่าน getShopLogo
    const rows = await getDb()
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.branchId, ctx.staff.branchId),
          ne(settings.key, "shop_logo")
        )
      );
    return mergeSettingDefaults(rows.map(r => [r.key, r.value] as const));
  }),

  getShopLogo: publicQuery.query(async ({ ctx }) => {
    const row = await getDb().query.settings.findFirst({
      where: and(
        eq(settings.branchId, ctx.staff.branchId),
        eq(settings.key, "shop_logo")
      ),
    });
    return row?.value || null;
  }),

  // ข้อมูลสำหรับเชื่อมต่อจากเครื่องอื่นใน LAN (multi-station) — urls คืนเสมอให้หน้า Settings preview ได้
  // ส่วนหน้า Login จะแสดงเฉพาะตอน enabled (เปิดใน Settings แล้วรีสตาร์ทแอป)
  lanInfo: anonymousQuery.query(async () => {
    // LAN discovery is a local-development legacy feature. Never disclose
    // container interface addresses from the public cloud endpoint.
    if (isPublicCloudRuntime()) {
      return { enabled: false, port: 0, urls: [] as string[] };
    }
    const db = getDb();
    let enabled = false;
    try {
      const [row] = await db
        .select()
        .from(settings)
        .where(and(eq(settings.branchId, 1), eq(settings.key, "lan_enabled")));
      enabled = row?.value === "1";
    } catch {
      // ตาราง settings ยังไม่พร้อม — ถือว่าปิด
    }
    const port = parseInt(process.env.PORT || "3000");
    const urls = getLanUrls(port);
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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // ตัด key ซ้ำโดยให้ค่าตัวท้ายสุดชนะ แล้วเขียนทั้งหมดใน transaction เดียว
      const entries = [
        ...new Map(input.entries.map(entry => [entry.key, entry.value])),
      ].map(([key, value]) => ({
        branchId: ctx.staff.branchId,
        key,
        value,
      }));
      if (entries.length > 0) {
        await db
          .insert(settings)
          .values(entries)
          .onConflictDoUpdate({
            target: [settings.branchId, settings.key],
            set: { value: sql`excluded.value` },
          });
      }

      // อ่านกลับจากฐานข้อมูลจริงให้ client ใช้เป็น source of truth ทันทีหลังบันทึก
      const rows = await db
        .select()
        .from(settings)
        .where(
          and(
            eq(settings.branchId, ctx.staff.branchId),
            ne(settings.key, "shop_logo")
          )
        );
      return {
        ok: true,
        settings: mergeSettingDefaults(
          rows.map(r => [r.key, r.value] as const)
        ),
      };
    }),

  updateBillPromotion: managerQuery
    .input(
      z.object({
        enabled: z.boolean(),
        name: z.string().trim().min(1).max(80),
        minimumFuelSpend: z.number().positive().max(999_999_999),
        discount: z.number().positive().max(999_999_999),
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const promotionValues: Record<string, string> = {
        bill_promotion_enabled: input.enabled ? "1" : "0",
        bill_promotion_name: input.name,
        bill_promotion_min_fuel_spend: String(input.minimumFuelSpend),
        bill_promotion_discount: String(input.discount),
        bill_promotion_start_date: input.startDate,
        bill_promotion_end_date: input.endDate,
      };
      const validationError =
        billPromotionSettingsValidationMessage(promotionValues);
      if (validationError) throw new Error(validationError);

      const db = getDb();
      await db
        .insert(settings)
        .values(
          Object.entries(promotionValues).map(([key, value]) => ({
            branchId: ctx.staff.branchId,
            key,
            value,
          }))
        )
        .onConflictDoUpdate({
          target: [settings.branchId, settings.key],
          set: { value: sql`excluded.value` },
        });

      logAudit({
        action: "promotion.settings.update",
        ...actorFromReq(ctx.req),
        detail: input.enabled
          ? `ตั้งโปรโมชั่น ${input.name}: เติมน้ำมันครบ ${input.minimumFuelSpend.toFixed(2)} บาท ลด ${input.discount.toFixed(2)} บาท (${input.startDate} ถึง ${input.endDate})`
          : `ปิดโปรโมชั่น ${input.name}`,
        refType: "settings",
      });

      const rows = await db
        .select()
        .from(settings)
        .where(
          and(
            eq(settings.branchId, ctx.staff.branchId),
            ne(settings.key, "shop_logo")
          )
        );
      return {
        ok: true,
        settings: mergeSettingDefaults(
          rows.map(row => [row.key, row.value] as const)
        ),
      };
    }),

  updatePerLiterPromotion: managerQuery
    .input(
      z.object({
        enabled: z.boolean(),
        name: z.string().trim().min(1).max(80),
        discountPerLiter: z.number().positive().max(999_999_999),
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const promotionValues: Record<string, string> = {
        promotion_per_liter_feature_enabled: "1",
        promotion_enabled: input.enabled ? "1" : "0",
        promotion_name: input.name,
        promotion_discount: String(input.discountPerLiter),
        promotion_start_date: input.startDate,
        promotion_end_date: input.endDate,
      };
      const validationError =
        promotionSettingsValidationMessage(promotionValues);
      if (validationError) throw new Error(validationError);

      const db = getDb();
      await db
        .insert(settings)
        .values(
          Object.entries(promotionValues).map(([key, value]) => ({
            branchId: ctx.staff.branchId,
            key,
            value,
          }))
        )
        .onConflictDoUpdate({
          target: [settings.branchId, settings.key],
          set: { value: sql`excluded.value` },
        });

      logAudit({
        action: "promotion.per_liter.settings.update",
        ...actorFromReq(ctx.req),
        detail: input.enabled
          ? `ตั้งโปรโมชั่น ${input.name}: ลด ${input.discountPerLiter.toFixed(2)} บาท/ลิตร (${input.startDate} ถึง ${input.endDate})`
          : `ปิดโปรโมชั่นต่อลิตร ${input.name}`,
        refType: "settings",
      });

      const rows = await db
        .select()
        .from(settings)
        .where(
          and(
            eq(settings.branchId, ctx.staff.branchId),
            ne(settings.key, "shop_logo")
          )
        );
      return {
        ok: true,
        settings: mergeSettingDefaults(
          rows.map(row => [row.key, row.value] as const)
        ),
      };
    }),
});

import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { dayRange } from "../lib/dates";
import { shiftCashSummary } from "../lib/cash";
import { queryExpenses } from "./expenses";
import {
  debtPayments,
  fuelTanks,
  priceChanges,
  products,
  saleItems,
  sales,
  shifts,
  tankRefills,
} from "@db/schema";
import {
  buildDailyWorkbook,
  buildFuelStockWorkbook,
  buildRangeWorkbook,
  type DailyReportData,
  type FuelStockPeriodRow,
  type FuelStockProductRow,
  type FuelStockSummaryData,
  type FuelProfitRow,
} from "../lib/excelExport";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD");
const fuelStockInputSchema = z
  .object({
    view: z.enum(["monthly", "yearly"]),
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12).optional(),
  })
  .refine(
    input => input.year <= bangkokParts(new Date()).year,
    "ยังไม่สามารถออกรายงานของปีในอนาคตได้"
  );

/** Date → "YYYY-MM-DD" แบบ local (ห้ามใช้ toISOString เพราะจะเป็น UTC) */
function toDateStr(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokBoundary(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day) - BANGKOK_OFFSET_MS);
}

function bangkokParts(date: Date) {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
  };
}

type FuelStockView = "monthly" | "yearly";
type FuelMovement = {
  receivedLiters: number;
  purchaseCost: number;
  refillCount: number;
  soldLiters: number;
  revenue: number;
  configuredSaleValue: number;
  stockProfit: number;
};

type FuelStockPeriod = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  calendarEnd: Date;
  isPartial: boolean;
};

const emptyMovement = (): FuelMovement => ({
  receivedLiters: 0,
  purchaseCost: 0,
  refillCount: 0,
  soldLiters: 0,
  revenue: 0,
  configuredSaleValue: 0,
  stockProfit: 0,
});

function makeFuelStockPeriods(
  view: FuelStockView,
  anchorYear: number,
  now: Date
): FuelStockPeriod[] {
  const current = bangkokParts(now);
  const years =
    view === "yearly"
      ? Array.from({ length: 5 }, (_, index) => anchorYear - 4 + index)
      : [anchorYear];
  const periods: FuelStockPeriod[] = [];

  for (const year of years) {
    const monthCount =
      view === "monthly" ? (year === current.year ? current.month + 1 : 12) : 1;
    for (let index = 0; index < monthCount; index += 1) {
      const month = view === "monthly" ? index : 0;
      const start = bangkokBoundary(year, month);
      if (start > now) continue;
      const calendarEnd =
        view === "monthly"
          ? bangkokBoundary(year, month + 1)
          : bangkokBoundary(year + 1, 0);
      const end = calendarEnd > now ? now : calendarEnd;
      periods.push({
        key:
          view === "monthly"
            ? `${year}-${String(month + 1).padStart(2, "0")}`
            : String(year),
        label:
          view === "monthly"
            ? `${THAI_MONTHS[month]} ${year + 543}`
            : `ปี ${year + 543}`,
        start,
        end,
        calendarEnd,
        isPartial: end.getTime() < calendarEnd.getTime(),
      });
    }
  }
  return periods;
}

function addMovement(
  target: Map<number, FuelMovement>,
  productId: number,
  patch: Partial<FuelMovement>
) {
  const current = target.get(productId) ?? emptyMovement();
  target.set(productId, {
    receivedLiters: r3(current.receivedLiters + (patch.receivedLiters ?? 0)),
    purchaseCost: r2(current.purchaseCost + (patch.purchaseCost ?? 0)),
    refillCount: current.refillCount + (patch.refillCount ?? 0),
    soldLiters: r3(current.soldLiters + (patch.soldLiters ?? 0)),
    revenue: r2(current.revenue + (patch.revenue ?? 0)),
    configuredSaleValue: r2(
      current.configuredSaleValue + (patch.configuredSaleValue ?? 0)
    ),
    stockProfit: r2(current.stockProfit + (patch.stockProfit ?? 0)),
  });
}

function fuelPeriodKey(date: Date, view: FuelStockView) {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  return view === "monthly"
    ? `${year}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
    : String(year);
}

function bangkokDayEnd(date: Date, now: Date) {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const end = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + 1
    ) -
      BANGKOK_OFFSET_MS -
      1
  );
  return end > now ? now : end;
}

async function queryFuelMovements(
  db: ReturnType<typeof getDb>,
  branchId: number,
  start: Date,
  end: Date,
  view?: FuelStockView
) {
  const refillPeriodSql =
    view === "monthly"
      ? sql<string>`to_char(${tankRefills.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM')`
      : view === "yearly"
        ? sql<string>`to_char(${tankRefills.createdAt} at time zone 'Asia/Bangkok', 'YYYY')`
        : sql<string>`'__all__'`;
  const salePeriodSql =
    view === "monthly"
      ? sql<string>`to_char(${sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM')`
      : view === "yearly"
        ? sql<string>`to_char(${sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY')`
        : sql<string>`'__all__'`;
  const refillSelect = {
    periodKey: refillPeriodSql,
    productId: fuelTanks.productId,
    receivedLiters: sql<number>`coalesce(sum(${tankRefills.liters}), 0)`,
    purchaseCost: sql<number>`coalesce(sum(${tankRefills.liters} * ${tankRefills.costPerLiter}), 0)`,
    refillCount: sql<number>`count(*)`,
  };
  const saleSelect = {
    periodKey: salePeriodSql,
    productId: products.id,
    soldLiters: sql<number>`coalesce(sum(${saleItems.qty}), 0)`,
    revenue: sql<number>`coalesce(sum(${saleItems.amount}), 0)`,
  };

  let refillQuery = db
    .select(refillSelect)
    .from(tankRefills)
    .innerJoin(
      fuelTanks,
      and(
        eq(tankRefills.tankId, fuelTanks.id),
        eq(fuelTanks.branchId, branchId)
      )
    )
    .where(
      and(
        eq(tankRefills.branchId, branchId),
        gte(tankRefills.createdAt, start),
        lt(tankRefills.createdAt, end)
      )
    )
    .$dynamic();
  let saleQuery = db
    .select(saleSelect)
    .from(saleItems)
    .innerJoin(
      sales,
      and(eq(saleItems.saleId, sales.id), eq(sales.branchId, branchId))
    )
    .innerJoin(
      products,
      and(eq(saleItems.productId, products.id), eq(products.branchId, branchId))
    )
    .where(
      and(
        eq(saleItems.branchId, branchId),
        eq(sales.status, "completed"),
        eq(products.category, "fuel"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end)
      )
    )
    .$dynamic();

  if (view) {
    refillQuery = refillQuery.groupBy(refillPeriodSql, fuelTanks.productId);
    saleQuery = saleQuery.groupBy(salePeriodSql, products.id);
  } else {
    refillQuery = refillQuery.groupBy(fuelTanks.productId);
    saleQuery = saleQuery.groupBy(products.id);
  }

  const [refillRows, saleRows] = await Promise.all([refillQuery, saleQuery]);
  const result = new Map<string, Map<number, FuelMovement>>();
  const getBucket = (periodKey: string) => {
    const existing = result.get(periodKey);
    if (existing) return existing;
    const created = new Map<number, FuelMovement>();
    result.set(periodKey, created);
    return created;
  };

  for (const row of refillRows) {
    const periodKey = String(row.periodKey);
    addMovement(getBucket(periodKey), Number(row.productId), {
      receivedLiters: Number(row.receivedLiters),
      purchaseCost: Number(row.purchaseCost),
      refillCount: Number(row.refillCount),
    });
  }
  for (const row of saleRows) {
    const periodKey = String(row.periodKey);
    addMovement(getBucket(periodKey), Number(row.productId), {
      soldLiters: Number(row.soldLiters),
      revenue: Number(row.revenue),
    });
  }
  return result;
}

export async function queryFuelStockSummary(
  db: ReturnType<typeof getDb>,
  input: { view: FuelStockView; year: number },
  branchId: number,
  now = new Date()
): Promise<FuelStockSummaryData> {
  const periods = makeFuelStockPeriods(input.view, input.year, now);
  if (periods.length === 0) throw new Error("ไม่พบช่วงเวลาสำหรับรายงาน");
  const reportStart = periods[0]!.start;
  const reportEnd = periods.at(-1)!.end;

  const [
    productRows,
    tankRows,
    groupedMovements,
    refillPricingRows,
    priceChangeRows,
  ] = await Promise.all([
    db
      .select()
      .from(products)
      .where(
        and(eq(products.branchId, branchId), eq(products.category, "fuel"))
      )
      .orderBy(asc(products.name)),
    db.select().from(fuelTanks).where(eq(fuelTanks.branchId, branchId)),
    queryFuelMovements(db, branchId, reportStart, reportEnd, input.view),
    db
      .select({
        productId: fuelTanks.productId,
        liters: tankRefills.liters,
        costPerLiter: tankRefills.costPerLiter,
        createdAt: tankRefills.createdAt,
      })
      .from(tankRefills)
      .innerJoin(
        fuelTanks,
        and(
          eq(tankRefills.tankId, fuelTanks.id),
          eq(fuelTanks.branchId, branchId)
        )
      )
      .where(
        and(
          eq(tankRefills.branchId, branchId),
          gte(tankRefills.createdAt, reportStart),
          lt(tankRefills.createdAt, reportEnd)
        )
      ),
    db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.branchId, branchId))
      .orderBy(desc(priceChanges.createdAt), desc(priceChanges.id)),
  ]);

  const movementsByPeriod = new Map<string, Map<number, FuelMovement>>();
  for (const period of periods) {
    const merged = new Map<number, FuelMovement>();
    for (const [productId, values] of groupedMovements.get(period.key) ?? []) {
      addMovement(merged, productId, values);
    }
    movementsByPeriod.set(period.key, merged);
  }

  const productById = new Map(
    productRows.map(product => [product.id, product])
  );
  const priceChangesByProduct = new Map<
    number,
    Array<(typeof priceChangeRows)[number]>
  >();
  for (const change of priceChangeRows) {
    if (change.productId == null) continue;
    const changes = priceChangesByProduct.get(change.productId) ?? [];
    changes.push(change);
    priceChangesByProduct.set(change.productId, changes);
  }
  const configuredPriceAt = (productId: number, at: Date) => {
    let price = productById.get(productId)?.price ?? 0;
    for (const change of priceChangesByProduct.get(productId) ?? []) {
      if (change.createdAt > at) price = change.oldPrice;
    }
    return price;
  };
  for (const refill of refillPricingRows) {
    const bucket = movementsByPeriod.get(
      fuelPeriodKey(refill.createdAt, input.view)
    );
    if (!bucket) continue;
    const salePrice = configuredPriceAt(
      refill.productId,
      bangkokDayEnd(refill.createdAt, now)
    );
    addMovement(bucket, refill.productId, {
      configuredSaleValue: refill.liters * salePrice,
      stockProfit: refill.liters * (salePrice - refill.costPerLiter),
    });
  }

  const afterMovements =
    reportEnd < now
      ? await queryFuelMovements(db, branchId, reportEnd, now)
      : new Map<string, Map<number, FuelMovement>>();
  const after = afterMovements.get("__all__") ?? new Map();
  const currentByProduct = new Map<
    number,
    {
      liters: number;
      capacity: number;
      lowTankCount: number;
      tankCount: number;
    }
  >();
  for (const tank of tankRows) {
    const current = currentByProduct.get(tank.productId) ?? {
      liters: 0,
      capacity: 0,
      lowTankCount: 0,
      tankCount: 0,
    };
    current.liters = r3(current.liters + tank.currentLiters);
    current.capacity = r3(current.capacity + tank.capacityLiters);
    current.lowTankCount += tank.currentLiters <= tank.lowAlertAt ? 1 : 0;
    current.tankCount += 1;
    currentByProduct.set(tank.productId, current);
  }

  const closingByProduct = new Map<number, number>();
  for (const product of productRows) {
    const current = currentByProduct.get(product.id)?.liters ?? 0;
    const movement = after.get(product.id) ?? emptyMovement();
    closingByProduct.set(
      product.id,
      r3(current - movement.receivedLiters + movement.soldLiters)
    );
  }

  const resultPeriods: FuelStockPeriodRow[] = [];
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const period = periods[index]!;
    const movementMap =
      movementsByPeriod.get(period.key) ?? new Map<number, FuelMovement>();
    const productItems: FuelStockProductRow[] = productRows.map(product => {
      const movement = movementMap.get(product.id) ?? emptyMovement();
      const closingStock = closingByProduct.get(product.id) ?? 0;
      const openingStock = r3(
        closingStock - movement.receivedLiters + movement.soldLiters
      );
      const hasPeriodCost =
        movement.receivedLiters > 0 && movement.purchaseCost > 0;
      const avgPurchaseCost = hasPeriodCost
        ? r3(movement.purchaseCost / movement.receivedLiters)
        : product.cost;
      const costOfSales = r2(movement.soldLiters * avgPurchaseCost);
      const grossProfit = r2(movement.revenue - costOfSales);
      const profitPerLiter =
        movement.receivedLiters > 0
          ? r3(movement.stockProfit / movement.receivedLiters)
          : 0;
      const averageStock = (openingStock + closingStock) / 2;
      closingByProduct.set(product.id, openingStock);

      return {
        productId: product.id,
        code: product.code,
        name: product.name,
        openingStock,
        receivedLiters: movement.receivedLiters,
        refillCount: movement.refillCount,
        purchaseCost: movement.purchaseCost,
        avgPurchaseCost,
        soldLiters: movement.soldLiters,
        revenue: movement.revenue,
        avgSalePrice:
          movement.receivedLiters > 0
            ? r3(movement.configuredSaleValue / movement.receivedLiters)
            : product.price,
        costOfSales,
        grossProfit,
        profitPerLiter,
        stockProfit: movement.stockProfit,
        grossMargin:
          movement.revenue > 0 ? r2((grossProfit / movement.revenue) * 100) : 0,
        closingStock,
        netMovement: r3(movement.receivedLiters - movement.soldLiters),
        inventoryTurnover:
          averageStock > 0 ? r2(movement.soldLiters / averageStock) : 0,
        costBasis: hasPeriodCost
          ? "period_weighted"
          : product.cost > 0
            ? "current_product"
            : "missing",
      };
    });

    const openingStock = r3(
      productItems.reduce((sum, item) => sum + item.openingStock, 0)
    );
    const closingStock = r3(
      productItems.reduce((sum, item) => sum + item.closingStock, 0)
    );
    const receivedLiters = r3(
      productItems.reduce((sum, item) => sum + item.receivedLiters, 0)
    );
    const purchaseCost = r2(
      productItems.reduce((sum, item) => sum + item.purchaseCost, 0)
    );
    const soldLiters = r3(
      productItems.reduce((sum, item) => sum + item.soldLiters, 0)
    );
    const revenue = r2(
      productItems.reduce((sum, item) => sum + item.revenue, 0)
    );
    const costOfSales = r2(
      productItems.reduce((sum, item) => sum + item.costOfSales, 0)
    );
    const grossProfit = r2(revenue - costOfSales);
    const stockProfit = r2(
      productItems.reduce((sum, item) => sum + item.stockProfit, 0)
    );
    const averageStock = (openingStock + closingStock) / 2;
    resultPeriods.unshift({
      key: period.key,
      label: period.label,
      start: period.start,
      end: period.end,
      isPartial: period.isPartial,
      openingStock,
      receivedLiters,
      refillCount: productItems.reduce(
        (sum, item) => sum + item.refillCount,
        0
      ),
      purchaseCost,
      avgPurchaseCost:
        receivedLiters > 0 ? r3(purchaseCost / receivedLiters) : 0,
      soldLiters,
      revenue,
      avgSalePrice:
        receivedLiters > 0
          ? r3(
              productItems.reduce(
                (sum, item) => sum + item.avgSalePrice * item.receivedLiters,
                0
              ) / receivedLiters
            )
          : 0,
      costOfSales,
      grossProfit,
      profitPerLiter: receivedLiters > 0 ? r3(stockProfit / receivedLiters) : 0,
      stockProfit,
      grossMargin: revenue > 0 ? r2((grossProfit / revenue) * 100) : 0,
      closingStock,
      netMovement: r3(receivedLiters - soldLiters),
      inventoryTurnover: averageStock > 0 ? r2(soldLiters / averageStock) : 0,
      products: productItems,
    });
  }

  const currentProducts = productRows.map(product => {
    const current = currentByProduct.get(product.id) ?? {
      liters: 0,
      capacity: 0,
      lowTankCount: 0,
      tankCount: 0,
    };
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      currentLiters: current.liters,
      capacityLiters: current.capacity,
      fillPercent:
        current.capacity > 0
          ? r2((current.liters / current.capacity) * 100)
          : 0,
      lowTankCount: current.lowTankCount,
      tankCount: current.tankCount,
      estimatedValue: r2(current.liters * product.cost),
      currentCostPerLiter: product.cost,
    };
  });
  const receivedLiters = r3(
    resultPeriods.reduce((sum, period) => sum + period.receivedLiters, 0)
  );
  const purchaseCost = r2(
    resultPeriods.reduce((sum, period) => sum + period.purchaseCost, 0)
  );
  const soldLiters = r3(
    resultPeriods.reduce((sum, period) => sum + period.soldLiters, 0)
  );
  const revenue = r2(
    resultPeriods.reduce((sum, period) => sum + period.revenue, 0)
  );
  const costOfSales = r2(
    resultPeriods.reduce((sum, period) => sum + period.costOfSales, 0)
  );
  const grossProfit = r2(revenue - costOfSales);
  const stockProfit = r2(
    resultPeriods.reduce((sum, period) => sum + period.stockProfit, 0)
  );
  const openingStock = resultPeriods[0]?.openingStock ?? 0;
  const closingStock = resultPeriods.at(-1)?.closingStock ?? 0;
  const averageStock = (openingStock + closingStock) / 2;
  const periodDays = Math.max(
    1,
    (reportEnd.getTime() - reportStart.getTime()) / 86_400_000
  );
  const currentStock = r3(
    currentProducts.reduce((sum, product) => sum + product.currentLiters, 0)
  );
  const topProduct =
    [...productRows]
      .map(product => ({
        productId: product.id,
        name: product.name,
        soldLiters: r3(
          resultPeriods.reduce(
            (sum, period) =>
              sum +
              (period.products.find(item => item.productId === product.id)
                ?.soldLiters ?? 0),
            0
          )
        ),
      }))
      .sort((a, b) => b.soldLiters - a.soldLiters)[0] ?? null;

  return {
    view: input.view,
    year: input.year,
    generatedAt: now,
    rangeStart: reportStart,
    rangeEnd: reportEnd,
    stockMethod:
      "ยอดคงเหลือย้อนหลังประมาณจากยอดคงเหลือปัจจุบัน ± รายการรับเข้าและยอดขายที่บันทึกในระบบ",
    profitMethod:
      "กำไรสต๊อกคำนวณรายวันจาก (ราคาขายที่ตั้งไว้ ณ สิ้นวัน − ราคาซื้อ) × จำนวนรับเข้า; วันนี้ใช้ราคาขายปัจจุบัน",
    totals: {
      openingStock,
      receivedLiters,
      refillCount: resultPeriods.reduce(
        (sum, period) => sum + period.refillCount,
        0
      ),
      purchaseCost,
      avgPurchaseCost:
        receivedLiters > 0 ? r3(purchaseCost / receivedLiters) : 0,
      soldLiters,
      revenue,
      avgSalePrice: soldLiters > 0 ? r3(revenue / soldLiters) : 0,
      costOfSales,
      grossProfit,
      profitPerLiter: receivedLiters > 0 ? r3(stockProfit / receivedLiters) : 0,
      stockProfit,
      grossMargin: revenue > 0 ? r2((grossProfit / revenue) * 100) : 0,
      closingStock,
      currentStock,
      currentCapacity: r3(
        currentProducts.reduce(
          (sum, product) => sum + product.capacityLiters,
          0
        )
      ),
      currentStockValue: r2(
        currentProducts.reduce(
          (sum, product) => sum + product.estimatedValue,
          0
        )
      ),
      netMovement: r3(receivedLiters - soldLiters),
      inventoryTurnover: averageStock > 0 ? r2(soldLiters / averageStock) : 0,
      stockCoverageDays:
        soldLiters > 0 ? r2(currentStock / (soldLiters / periodDays)) : null,
      lowTankCount: currentProducts.reduce(
        (sum, product) => sum + product.lowTankCount,
        0
      ),
      topProduct: topProduct && topProduct.soldLiters > 0 ? topProduct : null,
    },
    periods: resultPeriods,
    currentProducts,
  };
}

/**
 * รายงานปิดวัน (Z-report) ของวันที่ระบุ — ใช้ร่วมกันทั้งหน้าเว็บและส่งออก Excel
 * คืน bills + fuelProfit ด้วย (ข้อมูลต้นทุน) — procedure สาธารณะต้อง strip ออกก่อนส่ง
 */
export async function queryDailyReport(
  db: ReturnType<typeof getDb>,
  date: string,
  branchId: number
): Promise<DailyReportData> {
  const { start, end } = dayRange(date);
  const inDay = (col: SQLWrapper) => and(gte(col, start), lt(col, end));

  // ---- บิลของวัน ----
  const saleRows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.branchId, branchId), inDay(sales.createdAt)))
    .orderBy(asc(sales.createdAt));
  const completed = saleRows.filter(s => s.status === "completed");
  const voided = saleRows.filter(s => s.status === "voided");

  const byMethod = Object.fromEntries(
    PAY_METHODS.map(m => {
      const rows = completed.filter(s => s.paymentMethod === m);
      return [
        m,
        {
          count: rows.length,
          total: r2(rows.reduce((s, r) => s + r.total, 0)),
        },
      ];
    })
  ) as Record<(typeof PAY_METHODS)[number], { count: number; total: number }>;

  // ---- ลิตรน้ำมัน + กำไร (sale_items ของบิล completed เฉพาะสินค้าหมวด fuel) ----
  const fuelByName = new Map<
    string,
    { liters: number; revenue: number; costPerLiter: number }
  >();
  let totalLiters = 0;
  if (completed.length > 0) {
    const itemRows = await db
      .select()
      .from(saleItems)
      .where(
        and(
          eq(saleItems.branchId, branchId),
          inArray(
            saleItems.saleId,
            completed.map(s => s.id)
          )
        )
      );
    const prodRows = await db.query.products.findMany({
      where: (row, operators) => operators.eq(row.branchId, branchId),
    });
    for (const it of itemRows) {
      const p = prodRows.find(pr => pr.id === it.productId);
      if (p?.category !== "fuel") continue;
      const acc = fuelByName.get(it.name) ?? {
        liters: 0,
        revenue: 0,
        costPerLiter: p.cost,
      };
      acc.liters = r2(acc.liters + it.qty);
      acc.revenue = r2(acc.revenue + it.amount);
      fuelByName.set(it.name, acc);
      totalLiters = r2(totalLiters + it.qty);
    }
  }
  const fuelLiters = [...fuelByName.entries()].map(([name, v]) => ({
    name,
    liters: v.liters,
  }));
  // กำไรโดยประมาณจากต้นทุนสินค้าปัจจุบัน (cost = 0 คือยังไม่ได้ตั้งต้นทุน)
  const fuelProfit: FuelProfitRow[] = [...fuelByName.entries()].map(
    ([name, v]) => ({
      name,
      liters: v.liters,
      revenue: v.revenue,
      costPerLiter: v.costPerLiter,
      profitPerLiter:
        v.liters > 0 ? r2(v.revenue / v.liters - v.costPerLiter) : 0,
      profitTotal: r2(v.revenue - v.costPerLiter * v.liters),
    })
  );

  // ---- กะที่เปิดหรือปิดในวันนั้น (แนบยอดเงินสดควรมี/ส่วนต่างต่อกะ) ----
  const shiftRows = await db
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.branchId, branchId),
        or(
          inDay(shifts.openedAt),
          and(gte(shifts.closedAt, start), lt(shifts.closedAt, end))
        )
      )
    )
    .orderBy(asc(shifts.openedAt));
  const shiftsWithCash = await Promise.all(
    shiftRows.map(async s => {
      // ใช้ snapshot ตอนปิดกะถ้ามี; กะเก่า (null) คำนวณย้อนหลังจากข้อมูลปัจจุบัน
      const cashExpected =
        s.expectedCash ?? (await shiftCashSummary(db, s)).expectedCash;
      return {
        ...s,
        cashExpected,
        cashDiff:
          s.countedCash != null ? r2(s.countedCash - cashExpected) : null,
      };
    })
  );

  // ---- ค่าใช้จ่ายของวัน (logic เดียวกับ expenses.list) ----
  const expenseResult = await queryExpenses(db, { branchId, start, end });

  // ---- รับชำระหนี้ของวัน (แนบชื่อลูกค้า) ----
  const payRows = await db
    .select()
    .from(debtPayments)
    .where(
      and(eq(debtPayments.branchId, branchId), inDay(debtPayments.createdAt))
    )
    .orderBy(desc(debtPayments.createdAt));
  const custRows = await db.query.customers.findMany();
  const debtItems = payRows.map(p => ({
    ...p,
    customerName: custRows.find(c => c.id === p.customerId)?.name ?? "",
  }));
  const debtByMethod = Object.fromEntries(
    DEBT_METHODS.map(m => [
      m,
      r2(payRows.filter(p => p.method === m).reduce((s, p) => s + p.amount, 0)),
    ])
  ) as Record<(typeof DEBT_METHODS)[number], number>;
  const debtTotal = r2(payRows.reduce((s, p) => s + p.amount, 0));

  return {
    date,
    totalSales: r2(completed.reduce((s, r) => s + r.total, 0)),
    billCount: completed.length,
    voidedCount: voided.length,
    voidedTotal: r2(voided.reduce((s, r) => s + r.total, 0)),
    discountTotal: r2(completed.reduce((s, r) => s + r.discount, 0)),
    vatTotal: r2(completed.reduce((s, r) => s + r.vatAmount, 0)),
    byMethod,
    fuelLiters,
    totalLiters,
    fuelProfit,
    shifts: shiftsWithCash,
    expenses: expenseResult,
    debtPayments: {
      items: debtItems,
      total: debtTotal,
      byMethod: debtByMethod,
    },
    // เงินสดที่ควรมีในลิ้นชัก = ขายเงินสด + รับชำระหนี้เงินสด − ค่าใช้จ่าย
    expectedCash: r2(
      byMethod.cash.total + debtByMethod.cash - expenseResult.total
    ),
    bills: saleRows,
  };
}

export const reportsRouter = createRouter({
  // Z-report หน้าเว็บ — strip bills + fuelProfit (ข้อมูลต้นทุน) ออก เหลือเฉพาะยอดขาย
  daily: publicQuery
    .input(z.object({ date: dateSchema }))
    .query(async ({ input, ctx }) => {
      const {
        bills: _bills,
        fuelProfit: _profit,
        ...pub
      } = await queryDailyReport(getDb(), input.date, ctx.staff.branchId);
      return pub;
    }),

  // กำไรโดยประมาณต่อลิตรของวัน (มีข้อมูลต้นทุน — เฉพาะ admin/manager)
  fuelProfit: managerQuery
    .input(z.object({ date: dateSchema }))
    .query(async ({ input, ctx }) => {
      const r = await queryDailyReport(getDb(), input.date, ctx.staff.branchId);
      return { date: r.date, items: r.fuelProfit };
    }),

  // สรุปรับเข้า-ขายออก-คงเหลือและกำไรน้ำมัน เฉพาะผู้ที่เห็นข้อมูลต้นทุน
  fuelStockSummary: managerQuery
    .input(fuelStockInputSchema)
    .query(({ input, ctx }) =>
      queryFuelStockSummary(getDb(), input, ctx.staff.branchId)
    ),

  exportFuelStockExcel: managerQuery
    .input(fuelStockInputSchema)
    .query(async ({ input, ctx }) => {
      const summary = await queryFuelStockSummary(
        getDb(),
        input,
        ctx.staff.branchId
      );
      const exportMonth = input.month ?? bangkokParts(new Date()).month + 1;
      const periodKey =
        input.view === "monthly"
          ? `${input.year}-${String(exportMonth).padStart(2, "0")}`
          : String(input.year);
      const period = summary.periods.find(item => item.key === periodKey);
      if (!period) throw new Error("ไม่พบงวดที่ต้องการส่งออก");
      const buf = await buildFuelStockWorkbook(summary, period.key);
      return {
        fileName:
          input.view === "monthly"
            ? `fuel-stock-${input.year}-${String(exportMonth).padStart(2, "0")}.xlsx`
            : `fuel-stock-${input.year}.xlsx`,
        contentBase64: buf.toString("base64"),
      };
    }),

  // ส่งออก Z-report ของวันเป็น Excel (base64 — หน้าเว็บแปลงเป็นไฟล์ดาวน์โหลด)
  exportDailyExcel: managerQuery
    .input(z.object({ date: dateSchema }))
    .query(async ({ input, ctx }) => {
      const daily = await queryDailyReport(
        getDb(),
        input.date,
        ctx.staff.branchId
      );
      const buf = await buildDailyWorkbook(daily);
      return {
        fileName: `zreport-${input.date}.xlsx`,
        contentBase64: buf.toString("base64"),
      };
    }),

  // ส่งออกยอดขายช่วงเวลาเป็น Excel (สูงสุด 92 วัน)
  exportRangeExcel: managerQuery
    .input(z.object({ from: dateSchema, to: dateSchema }))
    .query(async ({ input, ctx }) => {
      const { start } = dayRange(input.from);
      const { end } = dayRange(input.to); // end = ต้นวันถัดจาก to
      const nDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      if (nDays < 1) throw new Error("วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
      if (nDays > 92)
        throw new Error("ช่วงเวลาส่งออกยาวเกินไป (สูงสุด 92 วันต่อครั้ง)");

      const db = getDb();
      const days: DailyReportData[] = [];
      for (
        let d = start;
        d < end;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      ) {
        days.push(await queryDailyReport(db, toDateStr(d), ctx.staff.branchId));
      }

      // รวมกำไรน้ำมันทั้งช่วง (ต่อชนิดน้ำมัน)
      const acc = new Map<
        string,
        {
          liters: number;
          revenue: number;
          profitTotal: number;
          costPerLiter: number;
        }
      >();
      for (const d of days) {
        for (const p of d.fuelProfit) {
          const a = acc.get(p.name) ?? {
            liters: 0,
            revenue: 0,
            profitTotal: 0,
            costPerLiter: p.costPerLiter,
          };
          a.liters = r2(a.liters + p.liters);
          a.revenue = r2(a.revenue + p.revenue);
          a.profitTotal = r2(a.profitTotal + p.profitTotal);
          acc.set(p.name, a);
        }
      }
      const profit: FuelProfitRow[] = [...acc.entries()].map(([name, a]) => ({
        name,
        liters: a.liters,
        revenue: a.revenue,
        costPerLiter: a.costPerLiter,
        profitPerLiter: a.liters > 0 ? r2(a.profitTotal / a.liters) : 0,
        profitTotal: a.profitTotal,
      }));

      const buf = await buildRangeWorkbook({
        from: input.from,
        to: input.to,
        days,
        profit,
      });
      return {
        fileName: `sales-${input.from.replaceAll("-", "")}_${input.to.replaceAll("-", "")}.xlsx`,
        contentBase64: buf.toString("base64"),
      };
    }),
});

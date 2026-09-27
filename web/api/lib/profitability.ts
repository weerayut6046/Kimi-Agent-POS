import { z } from "zod";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import {
  debtPayments,
  expenses,
  fuelTanks,
  nozzles,
  products as productTable,
  saleItems,
  sales,
  shiftReadings,
  shifts,
  tankRefills,
} from "@db/schema";
import { getDb } from "../queries/connection";

const CATEGORY_KEYS = ["fuel", "lubricant", "other"] as const;
type ProductCategory = (typeof CATEGORY_KEYS)[number];

const PAYMENT_METHODS = ["cash", "qr", "card", "credit", "thungngern"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  fuel: "น้ำมันเชื้อเพลิง",
  lubricant: "น้ำมันเครื่อง / 2T",
  other: "สินค้าอื่นๆ",
};

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

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD");
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "เดือนต้องอยู่ในรูปแบบ YYYY-MM");
const shiftIdSchema = z.number().int().positive().optional();

export const profitabilityInputSchema = z.discriminatedUnion("view", [
  z.object({
    view: z.literal("day"),
    date: dateSchema,
    shiftId: shiftIdSchema,
  }),
  z.object({
    view: z.literal("month"),
    month: monthSchema,
    shiftId: shiftIdSchema,
  }),
  z.object({
    view: z.literal("year"),
    year: z.number().int().min(2000).max(2100),
    shiftId: shiftIdSchema,
  }),
]);

export type ProfitabilityInput = z.infer<typeof profitabilityInputSchema>;

const r2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const r3 = (value: number) =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;

function bangkokBoundary(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day) - BANGKOK_OFFSET_MS);
}

function periodRange(input: ProfitabilityInput) {
  if (input.view === "day") {
    const [year, month, day] = input.date.split("-").map(Number);
    const start = bangkokBoundary(year!, month! - 1, day);
    return {
      start,
      end: bangkokBoundary(year!, month! - 1, day! + 1),
      value: input.date,
      label: new Intl.DateTimeFormat("th-TH", {
        dateStyle: "long",
        timeZone: "Asia/Bangkok",
      }).format(new Date(start.getTime() + 12 * 60 * 60 * 1000)),
    };
  }
  if (input.view === "month") {
    const [year, month] = input.month.split("-").map(Number);
    const start = bangkokBoundary(year!, month! - 1);
    return {
      start,
      end: bangkokBoundary(year!, month!),
      value: input.month,
      label: new Intl.DateTimeFormat("th-TH", {
        month: "long",
        year: "numeric",
        timeZone: "Asia/Bangkok",
      }).format(new Date(Date.UTC(year!, month! - 1, 15))),
    };
  }
  return {
    start: bangkokBoundary(input.year, 0),
    end: bangkokBoundary(input.year + 1, 0),
    value: String(input.year),
    label: `ปี ${input.year + 543}`,
  };
}

type TrendAccumulator = {
  key: string;
  label: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  billCount: number;
};

function makeTrend(input: ProfitabilityInput) {
  const buckets = new Map<string, TrendAccumulator>();
  if (input.view === "day") {
    for (let hour = 0; hour < 24; hour += 1) {
      const key = String(hour).padStart(2, "0");
      buckets.set(key, {
        key,
        label: `${key}:00`,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
        billCount: 0,
      });
    }
    return buckets;
  }
  if (input.view === "month") {
    const [year, month] = input.month.split("-").map(Number);
    const dayCount = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
    for (let day = 1; day <= dayCount; day += 1) {
      const key = String(day).padStart(2, "0");
      buckets.set(key, {
        key,
        label: `${day}`,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
        billCount: 0,
      });
    }
    return buckets;
  }
  for (let month = 1; month <= 12; month += 1) {
    const key = String(month).padStart(2, "0");
    buckets.set(key, {
      key,
      label: THAI_MONTHS[month - 1]!,
      revenue: 0,
      cost: 0,
      grossProfit: 0,
      expenses: 0,
      netProfit: 0,
      billCount: 0,
    });
  }
  return buckets;
}

const bangkokPartFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function trendKey(date: Date, view: ProfitabilityInput["view"]) {
  const parts = Object.fromEntries(
    bangkokPartFormatter
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  if (view === "day") return parts.hour!;
  if (view === "month") return parts.day!;
  return parts.month!;
}

type SalesAccumulator = {
  qty: number;
  revenue: number;
  cost: number;
  missingCostRevenue: number;
};

type ShiftAccumulator = {
  shiftId: number | null;
  staffName: string;
  openedAt: Date | null;
  closedAt: Date | null;
  status: "open" | "closed" | "unassigned";
  billCount: number;
  returnCount: number;
  revenue: number;
  cost: number;
  expenses: number;
};

const emptyAccumulator = (): SalesAccumulator => ({
  qty: 0,
  revenue: 0,
  cost: 0,
  missingCostRevenue: 0,
});

export async function queryProfitability(
  db: ReturnType<typeof getDb>,
  input: ProfitabilityInput,
  branchId: number
) {
  const range = periodRange(input);
  const periodSaleCondition = and(
    eq(sales.branchId, branchId),
    gte(sales.createdAt, range.start),
    lt(sales.createdAt, range.end),
    input.shiftId ? eq(sales.shiftId, input.shiftId) : undefined
  );
  const completedSaleCondition = and(
    periodSaleCondition,
    eq(sales.status, "completed")
  );
  const expenseCondition = and(
    eq(expenses.branchId, branchId),
    gte(expenses.createdAt, range.start),
    lt(expenses.createdAt, range.end),
    input.shiftId ? eq(expenses.shiftId, input.shiftId) : undefined
  );
  const debtPaymentCondition = and(
    eq(debtPayments.branchId, branchId),
    gte(debtPayments.createdAt, range.start),
    lt(debtPayments.createdAt, range.end),
    input.shiftId ? eq(debtPayments.shiftId, input.shiftId) : undefined
  );

  const [
    allSaleRows,
    itemRows,
    expenseRows,
    debtPaymentRows,
    shiftRows,
    activeShiftRows,
    receivedFuelCostRows,
  ] = await Promise.all([
    db
      .select({
        id: sales.id,
        shiftId: sales.shiftId,
        status: sales.status,
        transactionType: sales.transactionType,
        subtotal: sales.subtotal,
        discount: sales.discount,
        vatAmount: sales.vatAmount,
        total: sales.total,
        paymentMethod: sales.paymentMethod,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(periodSaleCondition),
    db
      .select({
        saleId: sales.id,
        productId: saleItems.productId,
        name: saleItems.name,
        unit: saleItems.unit,
        category: saleItems.productCategory,
        qty: saleItems.qty,
        amount: saleItems.amount,
        costPerUnit: saleItems.costPerUnit,
        saleSubtotal: sales.subtotal,
        saleTotal: sales.total,
        shiftId: sales.shiftId,
        createdAt: sales.createdAt,
      })
      .from(saleItems)
      .innerJoin(
        sales,
        and(
          eq(saleItems.saleId, sales.id),
          eq(saleItems.branchId, sales.branchId)
        )
      )
      .where(and(eq(saleItems.branchId, branchId), completedSaleCondition)),
    db
      .select({
        category: expenses.category,
        amount: expenses.amount,
        shiftId: expenses.shiftId,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(expenseCondition),
    db
      .select({
        method: debtPayments.method,
        amount: debtPayments.amount,
      })
      .from(debtPayments)
      .where(debtPaymentCondition),
    db
      .select({
        id: shifts.id,
        staffName: shifts.staffName,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        status: shifts.status,
        totalLiters: shifts.totalLiters,
        totalAmount: shifts.totalAmount,
        totalMoneyMeter: shifts.totalMoneyMeter,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.branchId, branchId),
          lt(shifts.openedAt, range.end),
          or(isNull(shifts.closedAt), gte(shifts.closedAt, range.start))
        )
      ),
    db
      .selectDistinct({ id: sales.shiftId })
      .from(sales)
      .where(and(completedSaleCondition, isNotNull(sales.shiftId))),
    db
      .select({
        id: tankRefills.id,
        productId: fuelTanks.productId,
        costPerLiter: tankRefills.costPerLiter,
        createdAt: tankRefills.createdAt,
      })
      .from(tankRefills)
      .innerJoin(
        fuelTanks,
        and(
          eq(tankRefills.tankId, fuelTanks.id),
          eq(tankRefills.branchId, fuelTanks.branchId)
        )
      )
      .where(
        and(
          eq(tankRefills.branchId, branchId),
          eq(fuelTanks.branchId, branchId)
        )
      )
      .orderBy(desc(tankRefills.createdAt), desc(tankRefills.id)),
  ]);

  // น้ำมันใช้ต้นทุนจากการรับเข้าล่าสุดของน้ำมันชนิดนั้น ส่วนสินค้าหมวดอื่น
  // ยังคงใช้ snapshot ณ เวลาขาย เพื่อไม่ให้ต้นทุนย้อนหลังเปลี่ยนตามหน้าสินค้า
  const latestReceivedFuelCost = new Map<number, number>();
  for (const row of receivedFuelCostRows) {
    if (!latestReceivedFuelCost.has(row.productId)) {
      latestReceivedFuelCost.set(row.productId, row.costPerLiter);
    }
  }

  const saleRows = allSaleRows.filter(sale => sale.status === "completed");
  const voidedSaleRows = allSaleRows.filter(sale => sale.status === "voided");

  const trend = makeTrend(input);
  const categories = new Map<ProductCategory, SalesAccumulator>(
    CATEGORY_KEYS.map(key => [key, emptyAccumulator()])
  );
  const products = new Map<
    string,
    SalesAccumulator & {
      productId: number | null;
      name: string;
      unit: string;
      category: ProductCategory;
    }
  >();
  const missingCostProducts = new Set<string>();
  const shiftMetadata = new Map(shiftRows.map(shift => [shift.id, shift]));
  const shiftAccumulators = new Map<number | null, ShiftAccumulator>();
  const shiftAccumulator = (shiftId: number | null) => {
    const existing = shiftAccumulators.get(shiftId);
    if (existing) return existing;
    const metadata = shiftId == null ? undefined : shiftMetadata.get(shiftId);
    const created: ShiftAccumulator = {
      shiftId,
      staffName: metadata?.staffName ?? "ไม่ระบุกะ",
      openedAt: metadata?.openedAt ?? null,
      closedAt: metadata?.closedAt ?? null,
      status: metadata?.status ?? "unassigned",
      billCount: 0,
      returnCount: 0,
      revenue: 0,
      cost: 0,
      expenses: 0,
    };
    shiftAccumulators.set(shiftId, created);
    return created;
  };
  let totalRevenue = 0;
  let totalCost = 0;
  let revenueForCoverage = 0;
  let missingCostRevenue = 0;

  for (const sale of saleRows) {
    const shift = shiftAccumulator(sale.shiftId);
    if (sale.transactionType === "sale") {
      shift.billCount += 1;
      const bucket = trend.get(trendKey(sale.createdAt, input.view));
      if (bucket) bucket.billCount += 1;
    } else {
      shift.returnCount += 1;
    }
  }

  for (const row of itemRows) {
    const revenue =
      row.saleSubtotal !== 0
        ? row.amount * (row.saleTotal / row.saleSubtotal)
        : row.amount;
    const costPerUnit =
      row.category === "fuel" &&
      row.productId != null &&
      latestReceivedFuelCost.has(row.productId)
        ? latestReceivedFuelCost.get(row.productId)!
        : row.costPerUnit;
    const cost = row.qty * costPerUnit;
    const isMissingCost = costPerUnit <= 0 && row.qty !== 0;
    totalRevenue += revenue;
    totalCost += cost;
    const shift = shiftAccumulator(row.shiftId);
    shift.revenue += revenue;
    shift.cost += cost;
    if (revenue > 0) {
      revenueForCoverage += revenue;
      if (isMissingCost) missingCostRevenue += revenue;
    }

    const category = row.category;
    const categoryAcc = categories.get(category)!;
    categoryAcc.qty += row.qty;
    categoryAcc.revenue += revenue;
    categoryAcc.cost += cost;
    if (isMissingCost) categoryAcc.missingCostRevenue += Math.abs(revenue);

    const productKey =
      row.productId == null
        ? `deleted:${category}:${row.unit}:${row.name}`
        : `product:${row.productId}`;
    const productAcc = products.get(productKey) ?? {
      ...emptyAccumulator(),
      productId: row.productId,
      name: row.name,
      unit: row.unit,
      category,
    };
    productAcc.qty += row.qty;
    productAcc.revenue += revenue;
    productAcc.cost += cost;
    if (isMissingCost) {
      productAcc.missingCostRevenue += Math.abs(revenue);
      missingCostProducts.add(row.name);
    }
    products.set(productKey, productAcc);

    const bucket = trend.get(trendKey(row.createdAt, input.view));
    if (bucket) {
      bucket.revenue += revenue;
      bucket.cost += cost;
    }
  }

  const expensesByCategory = new Map<string, number>();
  let expenseTotal = 0;
  for (const expense of expenseRows) {
    expenseTotal += expense.amount;
    shiftAccumulator(expense.shiftId).expenses += expense.amount;
    const category = expense.category.trim() || "ไม่ระบุหมวด";
    expensesByCategory.set(
      category,
      (expensesByCategory.get(category) ?? 0) + expense.amount
    );
    const bucket = trend.get(trendKey(expense.createdAt, input.view));
    if (bucket) bucket.expenses += expense.amount;
  }

  const categoryRows = CATEGORY_KEYS.map(key => {
    const value = categories.get(key)!;
    const profit = value.revenue - value.cost;
    return {
      key,
      label: CATEGORY_LABELS[key],
      qty: r3(value.qty),
      revenue: r2(value.revenue),
      cost: r2(value.cost),
      profit: r2(profit),
      margin: value.revenue !== 0 ? r2((profit / value.revenue) * 100) : 0,
      missingCostRevenue: r2(value.missingCostRevenue),
    };
  });

  const productRows = [...products.values()]
    .map(product => {
      const profit = product.revenue - product.cost;
      return {
        productId: product.productId,
        name: product.name,
        unit: product.unit,
        category: product.category,
        categoryLabel: CATEGORY_LABELS[product.category],
        qty: r3(product.qty),
        revenue: r2(product.revenue),
        cost: r2(product.cost),
        profit: r2(profit),
        margin:
          product.revenue !== 0 ? r2((profit / product.revenue) * 100) : 0,
        averageSalePrice:
          product.qty !== 0 ? r3(product.revenue / product.qty) : 0,
        averageCost: product.qty !== 0 ? r3(product.cost / product.qty) : 0,
        missingCost: product.missingCostRevenue > 0,
      };
    })
    .filter(
      product =>
        product.qty !== 0 || product.revenue !== 0 || product.cost !== 0
    )
    .sort((a, b) => b.revenue - a.revenue || b.profit - a.profit);

  const roundedTrend = [...trend.values()].map(bucket => {
    const grossProfit = bucket.revenue - bucket.cost;
    const netProfit = grossProfit - bucket.expenses;
    return {
      ...bucket,
      revenue: r2(bucket.revenue),
      cost: r2(bucket.cost),
      grossProfit: r2(grossProfit),
      expenses: r2(bucket.expenses),
      netProfit: r2(netProfit),
    };
  });

  const grossProfit = totalRevenue - totalCost;
  const netProfit = grossProfit - expenseTotal;
  const completedSales = saleRows.filter(row => row.transactionType === "sale");
  const completedReturns = saleRows.filter(
    row => row.transactionType === "return"
  );
  const grossSales = completedSales.reduce((sum, row) => sum + row.total, 0);
  const returns = completedReturns.reduce(
    (sum, row) => sum + Math.abs(row.total),
    0
  );
  const paymentBreakdown = Object.fromEntries(
    PAYMENT_METHODS.map(method => {
      const rows = saleRows.filter(sale => sale.paymentMethod === method);
      return [
        method,
        {
          count: rows.length,
          total: r2(rows.reduce((sum, sale) => sum + sale.total, 0)),
        },
      ];
    })
  ) as Record<
    (typeof PAYMENT_METHODS)[number],
    { count: number; total: number }
  >;
  const debtPaymentBreakdown = Object.fromEntries(
    DEBT_METHODS.map(method => [
      method,
      r2(
        debtPaymentRows
          .filter(payment => payment.method === method)
          .reduce((sum, payment) => sum + payment.amount, 0)
      ),
    ])
  ) as Record<(typeof DEBT_METHODS)[number], number>;
  const debtPaymentTotal = r2(
    debtPaymentRows.reduce((sum, payment) => sum + payment.amount, 0)
  );
  const fuelLitersByName = new Map<string, number>();
  for (const item of itemRows) {
    if (item.category !== "fuel") continue;
    fuelLitersByName.set(
      item.name,
      (fuelLitersByName.get(item.name) ?? 0) + item.qty
    );
  }
  const fuelLiters = [...fuelLitersByName.entries()]
    .map(([name, liters]) => ({ name, liters: r3(liters) }))
    .sort((a, b) => b.liters - a.liters || a.name.localeCompare(b.name, "th"));
  const zReportTotalSales = r2(
    saleRows.reduce((sum, sale) => sum + sale.total, 0)
  );
  const closedMeterShifts = shiftRows.filter(
    shift =>
      shift.status === "closed" &&
      shift.closedAt != null &&
      shift.closedAt >= range.start &&
      shift.closedAt < range.end &&
      (input.shiftId == null || shift.id === input.shiftId)
  );
  const fuelMeterShifts = closedMeterShifts.filter(
    shift =>
      shift.totalMoneyMeter > 0 ||
      shift.totalAmount > 0 ||
      shift.totalLiters > 0
  );
  const meterReadingRows =
    fuelMeterShifts.length > 0
      ? await db
          .select({
            shiftId: shiftReadings.shiftId,
            openMeter: shiftReadings.openMeter,
            closeMeter: shiftReadings.closeMeter,
            openMoney: shiftReadings.openMoney,
            closeMoney: shiftReadings.closeMoney,
            pricePerLiter: shiftReadings.pricePerLiter,
            costPerLiter: shiftReadings.costPerLiter,
            productId: nozzles.productId,
            productCode: productTable.code,
            productName: productTable.name,
          })
          .from(shiftReadings)
          .innerJoin(
            nozzles,
            and(
              eq(shiftReadings.nozzleId, nozzles.id),
              eq(shiftReadings.branchId, nozzles.branchId)
            )
          )
          .innerJoin(
            productTable,
            and(
              eq(nozzles.productId, productTable.id),
              eq(nozzles.branchId, productTable.branchId)
            )
          )
          .where(
            and(
              eq(shiftReadings.branchId, branchId),
              inArray(
                shiftReadings.shiftId,
                fuelMeterShifts.map(shift => shift.id)
              )
            )
          )
      : [];
  const meterShiftCount = fuelMeterShifts.filter(
    shift => shift.totalMoneyMeter > 0
  ).length;
  const fallbackShiftCount = fuelMeterShifts.filter(
    shift => shift.totalMoneyMeter <= 0 && shift.totalAmount > 0
  ).length;
  const fuelRevenueFromMeter = fuelMeterShifts.reduce(
    (sum, shift) =>
      sum +
      (shift.totalMoneyMeter > 0 ? shift.totalMoneyMeter : shift.totalAmount),
    0
  );
  const fuelLitersFromMeter = fuelMeterShifts.reduce(
    (sum, shift) => sum + shift.totalLiters,
    0
  );
  let fuelCostFromMeter = 0;
  let fuelCostCoveredLiters = 0;
  const fuelMeterShiftById = new Map(
    fuelMeterShifts.map(shift => [shift.id, shift])
  );
  const fuelTypeAccumulators = new Map<
    number,
    {
      productId: number;
      code: string;
      name: string;
      liters: number;
      revenue: number;
      cost: number;
      usesLatestReceivedCost: boolean;
    }
  >();
  for (const reading of meterReadingRows) {
    if (reading.closeMeter == null) continue;
    const liters = Math.max(0, reading.closeMeter - reading.openMeter);
    const usesLatestReceivedCost = latestReceivedFuelCost.has(
      reading.productId
    );
    const costPerLiter = usesLatestReceivedCost
      ? latestReceivedFuelCost.get(reading.productId)!
      : reading.costPerLiter;
    const shift = fuelMeterShiftById.get(reading.shiftId);
    const moneyFromMeter =
      reading.closeMoney == null
        ? 0
        : Math.max(0, reading.closeMoney - reading.openMoney);
    const revenue =
      shift != null && shift.totalMoneyMeter > 0
        ? moneyFromMeter
        : liters * reading.pricePerLiter;
    const cost = liters * costPerLiter;
    fuelCostFromMeter += cost;
    if (costPerLiter > 0) fuelCostCoveredLiters += liters;

    const accumulator = fuelTypeAccumulators.get(reading.productId) ?? {
      productId: reading.productId,
      code: reading.productCode,
      name: reading.productName,
      liters: 0,
      revenue: 0,
      cost: 0,
      usesLatestReceivedCost,
    };
    accumulator.liters += liters;
    accumulator.revenue += revenue;
    accumulator.cost += cost;
    accumulator.usesLatestReceivedCost =
      accumulator.usesLatestReceivedCost && usesLatestReceivedCost;
    fuelTypeAccumulators.set(reading.productId, accumulator);
  }
  const fuelTypes = [...fuelTypeAccumulators.values()]
    .map(fuel => {
      const profit = fuel.revenue - fuel.cost;
      return {
        productId: fuel.productId,
        code: fuel.code,
        name: fuel.name,
        liters: r3(fuel.liters),
        revenue: r2(fuel.revenue),
        costPerLiter: fuel.liters > 0 ? r3(fuel.cost / fuel.liters) : 0,
        cost: r2(fuel.cost),
        profitPerLiter: fuel.liters > 0 ? r3(profit / fuel.liters) : 0,
        profit: r2(profit),
        margin: fuel.revenue !== 0 ? r2((profit / fuel.revenue) * 100) : 0,
        usesLatestReceivedCost: fuel.usesLatestReceivedCost,
      };
    })
    .filter(fuel => fuel.liters > 0)
    .sort(
      (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "th")
    );
  const fuelCategory = categories.get("fuel")!;
  const fuelRevenueFromPos = fuelCategory.revenue;
  const otherProductRevenue = totalRevenue - fuelRevenueFromPos;
  const otherProductCost = totalCost - fuelCategory.cost;
  const meterAdjustedRevenue = fuelRevenueFromMeter + otherProductRevenue;
  const meterAdjustedCost = fuelCostFromMeter + otherProductCost;
  const meterAdjustedGrossProfit = meterAdjustedRevenue - meterAdjustedCost;
  const meterAdjustedNetProfit = meterAdjustedGrossProfit - expenseTotal;
  const meterTrendMap = new Map(
    [...trend.values()].map(bucket => [
      bucket.key,
      {
        key: bucket.key,
        label: bucket.label,
        revenue: 0,
        liters: 0,
      },
    ])
  );
  for (const shift of fuelMeterShifts) {
    if (shift.closedAt == null) continue;
    const bucket = meterTrendMap.get(trendKey(shift.closedAt, input.view));
    if (!bucket) continue;
    bucket.revenue +=
      shift.totalMoneyMeter > 0 ? shift.totalMoneyMeter : shift.totalAmount;
    bucket.liters += shift.totalLiters;
  }
  const meterTrend = [...meterTrendMap.values()].map(bucket => ({
    ...bucket,
    revenue: r2(bucket.revenue),
    liters: r3(bucket.liters),
  }));
  const activeShiftIds = new Set(activeShiftRows.map(shift => shift.id));
  const availableShifts = shiftRows
    .filter(shift => activeShiftIds.has(shift.id))
    .map(shift => ({
      id: shift.id,
      staffName: shift.staffName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      status: shift.status,
    }))
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const shiftSummaries = [...shiftAccumulators.values()]
    .map(shift => {
      const grossProfit = shift.revenue - shift.cost;
      const netProfit = grossProfit - shift.expenses;
      return {
        ...shift,
        revenue: r2(shift.revenue),
        cost: r2(shift.cost),
        grossProfit: r2(grossProfit),
        expenses: r2(shift.expenses),
        netProfit: r2(netProfit),
        margin:
          shift.revenue !== 0 ? r2((grossProfit / shift.revenue) * 100) : 0,
      };
    })
    .sort((a, b) => {
      if (a.openedAt == null) return 1;
      if (b.openedAt == null) return -1;
      return b.openedAt.getTime() - a.openedAt.getTime();
    });

  return {
    period: {
      view: input.view,
      value: range.value,
      label: range.label,
      start: range.start,
      end: range.end,
      shiftId: input.shiftId ?? null,
    },
    summary: {
      grossSales: r2(grossSales),
      returns: r2(returns),
      revenue: r2(totalRevenue),
      cost: r2(totalCost),
      grossProfit: r2(grossProfit),
      expenses: r2(expenseTotal),
      netProfit: r2(netProfit),
      grossMargin:
        totalRevenue !== 0 ? r2((grossProfit / totalRevenue) * 100) : 0,
      netMargin: totalRevenue !== 0 ? r2((netProfit / totalRevenue) * 100) : 0,
      billCount: completedSales.length,
      returnCount: completedReturns.length,
      averageBill:
        completedSales.length > 0 ? r2(grossSales / completedSales.length) : 0,
      discount: r2(completedSales.reduce((sum, row) => sum + row.discount, 0)),
      costCoveragePercent:
        revenueForCoverage > 0
          ? r2(
              ((revenueForCoverage - missingCostRevenue) / revenueForCoverage) *
                100
            )
          : 100,
      missingCostRevenue: r2(missingCostRevenue),
      missingCostProductCount: missingCostProducts.size,
    },
    zReport: {
      totalSales: zReportTotalSales,
      billCount: saleRows.length,
      saleCount: completedSales.length,
      returnCount: completedReturns.length,
      voidedCount: voidedSaleRows.length,
      voidedTotal: r2(
        voidedSaleRows.reduce((sum, sale) => sum + sale.total, 0)
      ),
      discountTotal: r2(saleRows.reduce((sum, sale) => sum + sale.discount, 0)),
      vatTotal: r2(saleRows.reduce((sum, sale) => sum + sale.vatAmount, 0)),
      byMethod: paymentBreakdown,
      fuelLiters,
      totalLiters: r3(fuelLiters.reduce((sum, fuel) => sum + fuel.liters, 0)),
      debtPayments: {
        total: debtPaymentTotal,
        byMethod: debtPaymentBreakdown,
      },
      expectedCash: r2(
        paymentBreakdown.cash.total + debtPaymentBreakdown.cash - expenseTotal
      ),
      reconciliationDifference: r2(zReportTotalSales - totalRevenue),
    },
    meterProfitSummary: {
      available: fuelMeterShifts.length > 0,
      closedShiftCount: closedMeterShifts.length,
      meterShiftCount,
      fallbackShiftCount,
      fuelRevenue: r2(fuelRevenueFromMeter),
      fuelLiters: r3(fuelLitersFromMeter),
      averagePricePerLiter:
        fuelLitersFromMeter > 0
          ? r3(fuelRevenueFromMeter / fuelLitersFromMeter)
          : 0,
      fuelRevenueFromPos: r2(fuelRevenueFromPos),
      fuelRevenueDifference: r2(fuelRevenueFromMeter - fuelRevenueFromPos),
      fuelCost: r2(fuelCostFromMeter),
      fuelTypes,
      fuelCostCoveragePercent:
        fuelLitersFromMeter > 0
          ? Math.min(
              100,
              r2((fuelCostCoveredLiters / fuelLitersFromMeter) * 100)
            )
          : 100,
      otherProductRevenue: r2(otherProductRevenue),
      otherProductCost: r2(otherProductCost),
      revenue: r2(meterAdjustedRevenue),
      cost: r2(meterAdjustedCost),
      expenses: r2(expenseTotal),
      grossProfit: r2(meterAdjustedGrossProfit),
      netProfit: r2(meterAdjustedNetProfit),
      netMargin:
        meterAdjustedRevenue !== 0
          ? r2((meterAdjustedNetProfit / meterAdjustedRevenue) * 100)
          : 0,
      trend: meterTrend,
    },
    trend: roundedTrend,
    availableShifts,
    shiftSummaries,
    categories: categoryRows,
    products: productRows,
    expensesByCategory: [...expensesByCategory.entries()]
      .map(([category, amount]) => ({ category, amount: r2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    missingCostProducts: [...missingCostProducts].sort((a, b) =>
      a.localeCompare(b, "th")
    ),
  };
}

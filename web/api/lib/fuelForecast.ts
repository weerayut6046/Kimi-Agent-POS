import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
  fuelTanks,
  nozzles,
  products,
  saleItems,
  sales,
  settings,
  shiftReadings,
  shifts,
} from "@db/schema";
import {
  DEFAULT_FUEL_FORECAST_SETTINGS,
  FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS,
  FUEL_FORECAST_SETTINGS_KEY,
  normalizeFuelForecastConfig,
  type FuelForecastLookbackDays,
  type FuelForecastSettings,
  type FuelForecastSummary,
  type FuelTankForecast,
} from "@contracts/fuelForecast";
import { getDb } from "../queries/connection";

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;
export function bangkokDate(date: Date): string {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}
export function fuelForecastPeriod(
  lookbackDays: FuelForecastLookbackDays,
  now: Date
) {
  const today = bangkokDate(now);
  const end = new Date(`${today}T00:00:00+07:00`);
  const start = new Date(end.getTime() - lookbackDays * DAY_MS);
  return {
    start,
    end,
    periodStart: bangkokDate(start),
    periodEnd: bangkokDate(new Date(end.getTime() - DAY_MS)),
  };
}
function futureDate(now: Date, days: number): string | null {
  const value = new Date(now.getTime() + days * DAY_MS);
  return Number.isFinite(value.getTime()) ? bangkokDate(value) : null;
}
function unavailableForecast() {
  return {
    daysLeft: null,
    orderByDate: null,
    expectedEmptyDate: null,
    expectedDeliveryDate: null,
    projectedDeliveryLiters: null,
    reorderPointLiters: null,
    suggestedOrderLiters: null,
    status: "insufficient_data" as const,
    capacityWarning: false,
  };
}

/** Delivery is planned for the suggested order time (never before now) plus lead time. */
export function calculateFuelForecast(
  currentLiters: number,
  capacityLiters: number,
  averageDailyLiters: number,
  policy: FuelForecastSettings,
  now: Date
): Pick<
  FuelTankForecast,
  | "daysLeft"
  | "orderByDate"
  | "expectedEmptyDate"
  | "expectedDeliveryDate"
  | "projectedDeliveryLiters"
  | "reorderPointLiters"
  | "suggestedOrderLiters"
  | "status"
  | "capacityWarning"
> {
  if (
    !Number.isFinite(currentLiters) ||
    currentLiters < 0 ||
    !Number.isFinite(capacityLiters) ||
    capacityLiters <= 0 ||
    currentLiters > capacityLiters ||
    !Number.isFinite(averageDailyLiters) ||
    averageDailyLiters <= 0
  )
    return unavailableForecast();
  const daysLeft = currentLiters / averageDailyLiters;
  const waitDays = Math.max(
    0,
    daysLeft - policy.leadTimeDays - policy.safetyStockDays
  );
  const orderByDate = futureDate(now, waitDays);
  const expectedEmptyDate = futureDate(now, daysLeft);
  if (!orderByDate || !expectedEmptyDate) return unavailableForecast();
  // Dates are actionable calendar dates, so use the earliest instant on the
  // delivery date. A quantity based on a hidden fractional time can overfill
  // the tank if the truck arrives earlier on that same displayed date.
  const orderDayStart = new Date(`${orderByDate}T00:00:00+07:00`);
  const deliveryDayStart = new Date(
    orderDayStart.getTime() + policy.leadTimeDays * DAY_MS
  );
  const deliveryDays = Math.max(
    0,
    (deliveryDayStart.getTime() - now.getTime()) / DAY_MS
  );
  const projected = Math.max(
    0,
    currentLiters - averageDailyLiters * deliveryDays
  );
  const reorderPoint =
    averageDailyLiters * (policy.leadTimeDays + policy.safetyStockDays);
  const target = averageDailyLiters * policy.targetCoverDays;
  const availableSpace = Math.max(0, capacityLiters - projected);
  // Round down the order, so the displayed quantity also stays within tank capacity.
  const order =
    Math.floor(
      Math.min(availableSpace, Math.max(0, target - projected)) * 1000 + 1e-7
    ) / 1000;
  return {
    daysLeft: round(daysLeft),
    orderByDate,
    expectedEmptyDate,
    expectedDeliveryDate: bangkokDate(deliveryDayStart),
    projectedDeliveryLiters: round(projected),
    reorderPointLiters: round(reorderPoint),
    suggestedOrderLiters: order,
    status:
      currentLiters <= averageDailyLiters * policy.leadTimeDays
        ? "urgent"
        : orderByDate <= bangkokDate(now)
          ? "order_now"
          : "ok",
    capacityWarning: target > capacityLiters || reorderPoint > capacityLiters,
  };
}

type Evidence = {
  days: Map<string, number>;
  meterShifts: Set<number>;
  posBills: Set<number>;
  warnings: Set<string>;
  unreliable: boolean;
};
const emptyEvidence = (): Evidence => ({
  days: new Map(),
  meterShifts: new Set(),
  posBills: new Set(),
  warnings: new Set(),
  unreliable: false,
});
function addDay(evidence: Evidence, date: Date, liters: number) {
  const day = bangkokDate(date);
  evidence.days.set(day, (evidence.days.get(day) ?? 0) + liters);
}

export async function queryFuelForecast(
  db: ReturnType<typeof getDb>,
  input: { lookbackDays: FuelForecastLookbackDays },
  branchId: number,
  now = new Date()
): Promise<FuelForecastSummary> {
  const range = fuelForecastPeriod(input.lookbackDays, now);
  const closedCondition = and(
    eq(shifts.branchId, branchId),
    eq(shifts.status, "closed"),
    gte(shifts.closedAt, range.start),
    lt(shifts.closedAt, range.end)
  );
  const [
    tanks,
    configRows,
    closedShifts,
    meterRows,
    posRows,
    openRows,
    priorMeterTanks,
  ] = await Promise.all([
    db
      .select({
        tankId: fuelTanks.id,
        tankName: fuelTanks.name,
        productId: fuelTanks.productId,
        productName: products.name,
        currentLiters: fuelTanks.currentLiters,
        capacityLiters: fuelTanks.capacityLiters,
      })
      .from(fuelTanks)
      .innerJoin(
        products,
        and(
          eq(fuelTanks.productId, products.id),
          eq(fuelTanks.branchId, products.branchId)
        )
      )
      .where(eq(fuelTanks.branchId, branchId))
      .orderBy(fuelTanks.id),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(
        and(
          eq(settings.branchId, branchId),
          eq(settings.key, FUEL_FORECAST_SETTINGS_KEY)
        )
      ),
    db
      .select({ id: shifts.id, totalLiters: shifts.totalLiters })
      .from(shifts)
      .where(closedCondition),
    db
      .select({
        shiftId: shifts.id,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        nozzleId: shiftReadings.nozzleId,
        openMeter: shiftReadings.openMeter,
        closeMeter: shiftReadings.closeMeter,
        tankId: nozzles.tankId,
        productId: nozzles.productId,
      })
      .from(shiftReadings)
      .innerJoin(
        shifts,
        and(
          eq(shiftReadings.shiftId, shifts.id),
          eq(shiftReadings.branchId, shifts.branchId)
        )
      )
      .leftJoin(
        nozzles,
        and(
          eq(shiftReadings.nozzleId, nozzles.id),
          eq(shiftReadings.branchId, nozzles.branchId)
        )
      )
      .where(and(eq(shiftReadings.branchId, branchId), closedCondition))
      .orderBy(shifts.openedAt, shifts.id),
    db
      .select({
        saleId: sales.id,
        shiftId: sales.shiftId,
        createdAt: sales.createdAt,
        closedAt: shifts.closedAt,
        transactionType: sales.transactionType,
        productId: saleItems.productId,
        qty: saleItems.qty,
      })
      .from(saleItems)
      .innerJoin(
        sales,
        and(
          eq(saleItems.saleId, sales.id),
          eq(saleItems.branchId, sales.branchId)
        )
      )
      .leftJoin(
        shifts,
        and(eq(sales.shiftId, shifts.id), eq(sales.branchId, shifts.branchId))
      )
      .where(
        and(
          eq(saleItems.branchId, branchId),
          eq(sales.branchId, branchId),
          eq(sales.status, "completed"),
          eq(saleItems.productCategory, "fuel"),
          lt(sales.createdAt, range.end),
          or(
            closedCondition,
            and(isNull(sales.shiftId), gte(sales.createdAt, range.start))
          )
        )
      ),
    db
      .select({ tankId: nozzles.tankId })
      .from(shiftReadings)
      .innerJoin(
        shifts,
        and(
          eq(shiftReadings.shiftId, shifts.id),
          eq(shiftReadings.branchId, shifts.branchId)
        )
      )
      .innerJoin(
        nozzles,
        and(
          eq(shiftReadings.nozzleId, nozzles.id),
          eq(shiftReadings.branchId, nozzles.branchId)
        )
      )
      .where(
        and(
          eq(shiftReadings.branchId, branchId),
          eq(shifts.branchId, branchId),
          eq(shifts.status, "open")
        )
      ),
    db
      .select({
        tankId: nozzles.tankId,
        productId: nozzles.productId,
        nozzleId: nozzles.id,
        lastClosedAt: sql<string>`max(${shifts.closedAt})`,
      })
      .from(shiftReadings)
      .innerJoin(
        shifts,
        and(
          eq(shiftReadings.shiftId, shifts.id),
          eq(shiftReadings.branchId, shifts.branchId)
        )
      )
      .innerJoin(
        nozzles,
        and(
          eq(shiftReadings.nozzleId, nozzles.id),
          eq(shiftReadings.branchId, nozzles.branchId)
        )
      )
      .where(
        and(
          eq(shiftReadings.branchId, branchId),
          eq(shifts.branchId, branchId),
          eq(shifts.status, "closed"),
          lt(shifts.closedAt, range.start),
          sql`${shiftReadings.closeMeter} >= ${shiftReadings.openMeter}`,
          sql`${shifts.closedAt} > ${shifts.openedAt}`
        )
      )
      .groupBy(nozzles.id, nozzles.tankId, nozzles.productId),
  ]);
  const config = normalizeFuelForecastConfig(configRows[0]?.value);
  const evidence = new Map(tanks.map(tank => [tank.tankId, emptyEvidence()]));
  const tankById = new Map(tanks.map(tank => [tank.tankId, tank]));
  const tanksByProduct = new Map<number, typeof tanks>();
  for (const tank of tanks)
    tanksByProduct.set(tank.productId, [
      ...(tanksByProduct.get(tank.productId) ?? []),
      tank,
    ]);
  function invalidateTank(tankId: number, warning: string) {
    const tankEvidence = evidence.get(tankId);
    if (tankEvidence) {
      tankEvidence.unreliable = true;
      tankEvidence.warnings.add(warning);
    }
  }
  function invalidateProduct(productId: number | null, warning: string) {
    for (const tank of productId == null
      ? tanks
      : (tanksByProduct.get(productId) ?? []))
      invalidateTank(tank.tankId, warning);
  }
  const duplicates = new Map<string, number>();
  const coverage = new Set<string>();
  const meteredProductDays = new Set<string>();
  const readingsByShift = new Map<number, typeof meterRows>();
  for (const row of meterRows) {
    const key = `${row.shiftId}:${row.nozzleId}`;
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
    readingsByShift.set(row.shiftId, [
      ...(readingsByShift.get(row.shiftId) ?? []),
      row,
    ]);
    if (row.productId != null && row.closedAt) {
      coverage.add(`${row.shiftId}:${row.productId}`);
      meteredProductDays.add(`${row.productId}:${bangkokDate(row.closedAt)}`);
    }
  }
  const lastClosedByNozzle = new Map<number, Date>(
    priorMeterTanks.map(row => [row.nozzleId, new Date(row.lastClosedAt)])
  );
  for (const row of meterRows) {
    const tank = row.tankId == null ? undefined : tankById.get(row.tankId);
    if (!tank || row.productId !== tank.productId) {
      invalidateProduct(
        row.productId,
        "พบมิเตอร์ที่ผูกถังไม่ได้หรือชนิดน้ำมันไม่ตรงกับถัง จึงคาดการณ์รายถังไม่ได้"
      );
      continue;
    }
    const value = evidence.get(tank.tankId)!;
    value.warnings.add(
      "ประวัติมิเตอร์ใช้การผูกหัวจ่ายกับถังปัจจุบัน หากเคยเปลี่ยนถังหรือชนิดน้ำมันควรตรวจประวัติก่อนใช้ผลคาดการณ์"
    );
    if (duplicates.get(`${row.shiftId}:${row.nozzleId}`)! > 1) {
      invalidateTank(
        tank.tankId,
        "พบรายการมิเตอร์ซ้ำในกะเดียวกัน กรุณาตรวจประวัติกะ"
      );
      continue;
    }
    const delta = row.closeMeter == null ? NaN : row.closeMeter - row.openMeter;
    if (
      !Number.isFinite(delta) ||
      delta < 0 ||
      !row.closedAt ||
      row.closedAt <= row.openedAt
    ) {
      invalidateTank(
        tank.tankId,
        "พบมิเตอร์ปิดกะไม่ครบ ค่าถอยหลัง หรือเวลาปิดกะไม่ถูกต้อง"
      );
      continue;
    }
    if (row.closedAt.getTime() - row.openedAt.getTime() > 2 * DAY_MS) {
      invalidateTank(
        tank.tankId,
        "พบกะยาวเกิน 2 วัน การรวมยอดในวันปิดกะอาจทำให้ค่าเฉลี่ยคลาดเคลื่อน"
      );
    }
    const previousClose = lastClosedByNozzle.get(row.nozzleId);
    if (previousClose && row.openedAt < previousClose) {
      invalidateTank(
        tank.tankId,
        "พบช่วงเวลากะซ้อนกันของหัวจ่ายเดียวกัน กรุณาตรวจประวัติกะ"
      );
      continue;
    }
    lastClosedByNozzle.set(row.nozzleId, row.closedAt);
    addDay(value, row.closedAt, round(delta));
    value.meterShifts.add(row.shiftId);
  }
  for (const shift of closedShifts) {
    const readings = readingsByShift.get(shift.id) ?? [];
    if (!Number.isFinite(shift.totalLiters) || shift.totalLiters < 0) {
      invalidateProduct(null, "พบยอดลิตรรวมของกะไม่ถูกต้อง กรุณาตรวจประวัติกะ");
    } else if (shift.totalLiters > 0 && readings.length === 0) {
      invalidateProduct(
        null,
        "พบกะที่มียอดลิตรรวมแต่ไม่มีมิเตอร์รายหัวจ่าย จึงจัดสรรยอดให้ถังไม่ได้"
      );
    } else if (readings.length > 0) {
      const total = readings.reduce(
        (sum, row) =>
          sum +
          (row.closeMeter == null
            ? 0
            : Math.max(0, round(row.closeMeter - row.openMeter))),
        0
      );
      if (Math.abs(total - shift.totalLiters) > 0.003) {
        invalidateProduct(
          null,
          "ยอดลิตรรวมของกะไม่ตรงกับมิเตอร์รายหัวจ่าย กรุณาตรวจประวัติกะ"
        );
      }
    }
  }
  for (const row of posRows) {
    if (row.productId == null) {
      invalidateProduct(
        null,
        "พบยอดขายน้ำมันที่ไม่ระบุสินค้า จึงจัดสรรยอดให้ถังไม่ได้"
      );
      continue;
    }
    const day = row.closedAt ?? row.createdAt;
    // A meter already includes fuel rung through POS. Unassigned POS on a metered
    // product/day is also omitted because there is no proof it is additional fuel.
    if (
      (row.shiftId != null &&
        coverage.has(`${row.shiftId}:${row.productId}`)) ||
      (row.shiftId == null &&
        meteredProductDays.has(`${row.productId}:${bangkokDate(day)}`))
    )
      continue;
    const productTanks = tanksByProduct.get(row.productId) ?? [];
    if (productTanks.length !== 1) {
      invalidateProduct(
        row.productId,
        "ยอด POS ไม่มีข้อมูลถัง และน้ำมันชนิดนี้มีหลายถัง จึงไม่แบ่งยอดโดยประมาณ"
      );
      continue;
    }
    const value = evidence.get(productTanks[0]!.tankId)!;
    const qty = row.transactionType === "return" ? -Math.abs(row.qty) : row.qty;
    if (!Number.isFinite(qty) || (row.transactionType === "sale" && qty < 0)) {
      invalidateProduct(
        row.productId,
        "พบปริมาณขายน้ำมันไม่ถูกต้องในประวัติ POS"
      );
      continue;
    }
    addDay(value, day, qty);
    value.posBills.add(row.saleId);
    value.unreliable = true;
    value.warnings.add(
      "ใช้ยอด POS ประกอบเมื่อไม่มีมิเตอร์ แต่ POS ไม่ยืนยันการตัดสต๊อกจริง ต้องมีมิเตอร์ปิดกะก่อนคาดการณ์"
    );
  }
  for (const row of openRows) {
    if (row.tankId != null)
      evidence
        .get(row.tankId)
        ?.warnings.add(
          "มีกะเปิดอยู่ สต๊อกในระบบยังไม่หักยอดมิเตอร์ของกะนี้จนกว่าจะปิดกะ"
        );
  }
  const forecasts: FuelTankForecast[] = tanks.map(tank => {
    const value = evidence.get(tank.tankId)!;
    const totalLiters = [...value.days.values()].reduce(
      (sum, liters) => sum + liters,
      0
    );
    const average = totalLiters / input.lookbackDays;
    const source =
      value.meterShifts.size > 0
        ? value.posBills.size > 0
          ? "mixed"
          : "meters"
        : value.posBills.size > 0
          ? "pos"
          : "none";
    const establishedAtStart =
      value.days.has(range.periodStart) ||
      priorMeterTanks.some(
        row => row.tankId === tank.tankId && row.productId === tank.productId
      );
    if (!establishedAtStart && value.days.size > 0)
      value.warnings.add(
        "ประวัติมิเตอร์เริ่มหลังวันแรกของช่วงที่เลือก ควรเลือกช่วงสั้นลงหรือเก็บประวัติให้ครบก่อนคาดการณ์"
      );
    if (value.days.size < FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS)
      value.warnings.add(
        `ต้องมีข้อมูลอย่างน้อย ${FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS} วัน ขณะนี้มี ${value.days.size} วัน`
      );
    if (totalLiters <= 0)
      value.warnings.add(
        value.days.size > 0
          ? "ยังไม่มีการใช้น้ำมันสุทธิเป็นบวก จึงประมาณวันหมดไม่ได้"
          : "ยังไม่มีประวัติมิเตอร์ปิดกะหรือยอดขายในช่วงที่เลือก"
      );
    if (
      !Number.isFinite(tank.capacityLiters) ||
      !Number.isFinite(tank.currentLiters) ||
      tank.capacityLiters <= 0 ||
      tank.currentLiters < 0 ||
      tank.currentLiters > tank.capacityLiters
    )
      invalidateTank(
        tank.tankId,
        "ความจุหรือสต๊อกถังไม่ถูกต้อง กรุณาตรวจข้อมูลถัง"
      );
    const policy = config[String(tank.tankId)] ?? {
      ...DEFAULT_FUEL_FORECAST_SETTINGS,
    };
    const reliable =
      !value.unreliable &&
      establishedAtStart &&
      value.days.size >= FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS &&
      average > 0;
    const calculation = reliable
      ? calculateFuelForecast(
          tank.currentLiters,
          tank.capacityLiters,
          average,
          policy,
          now
        )
      : unavailableForecast();
    if (calculation.capacityWarning)
      value.warnings.add(
        "ความจุถังไม่พอสำหรับวันสำรองที่ตั้งไว้ ต้องส่งน้ำมันบ่อยขึ้นหรือปรับแผนสต๊อก"
      );
    return {
      ...tank,
      settings: policy,
      historical: {
        totalLiters: round(totalLiters),
        averageDailyLiters: round(average),
        calendarDays: input.lookbackDays,
        evidenceDays: value.days.size,
        meterShifts: value.meterShifts.size,
        posBills: value.posBills.size,
        source,
      },
      ...calculation,
      warnings: [...value.warnings],
    };
  });
  return {
    generatedAt: now.toISOString(),
    timezone: "Asia/Bangkok",
    lookbackDays: input.lookbackDays,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    minimumEvidenceDays: FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS,
    method:
      "ใช้ลิตรจากมิเตอร์กะที่ปิดแล้ว รวมตามวันปิดกะในเวลาไทย หารด้วยทุกวันในช่วงย้อนหลังรวมวันยอดศูนย์ ไม่รวมวันนี้และไม่นับ POS ซ้ำกับมิเตอร์ วันที่ส่งคำนวณจากวันที่ควรสั่งรวมเวลาส่ง ลิตรสั่งซื้อเผื่อรถมาถึงต้นวันเพื่อไม่เกินความจุ โดยยังไม่รวมใบสั่งซื้อที่รอรับ",
    tanks: forecasts,
  };
}

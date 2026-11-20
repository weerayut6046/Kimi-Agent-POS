export type FuelCostEvent = {
  id: string;
  at: string;
  kind: "receipt" | "sale" | "return";
  liters: number;
  netAmount: number | null;
  originalItemId?: string;
  reference: string;
};

export type FuelCostOpening = {
  at: string;
  liters: number;
  unitCost: number;
};

const precision = (value: number) => Math.round(value * 1e6) / 1e6;
const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Replay immutable receipt amounts and sale quantities in event-time order.
 * Opening stock and all amounts are exclusive of recoverable VAT.
 * A missing purchase cost or stock deficit propagates an unknown value.
 */
export function calculateFuelCostLedger(
  opening: FuelCostOpening,
  events: readonly FuelCostEvent[],
  from: string,
  to: string
) {
  let liters = opening.liters;
  let value: number | null = precision(liters * opening.unitCost);
  const originalCosts = new Map<string, number | null>();
  const rows = [];
  let revenue = 0;
  let costOfSales = 0;
  let soldLiters = 0;
  let receivedLiters = 0;
  let complete = opening.at <= from;
  let openingLiters = liters;
  let openingValue = value as number | null;
  let started = false;

  const ordered = [...events]
    .filter(event => event.at >= opening.at && event.at < to)
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        (a.kind === "receipt" ? 0 : 1) - (b.kind === "receipt" ? 0 : 1) ||
        a.id.localeCompare(b.id, "en", { numeric: true })
    );

  for (const event of ordered) {
    const inRange = event.at >= from;
    if (inRange && !started) {
      openingLiters = liters;
      openingValue = value;
      started = true;
    }
    let cost: number | null = null;
    let issue: string | null = null;
    const average: number | null =
      liters > 0 && value != null ? value / liters : null;

    if (event.kind === "receipt") {
      if (liters === 0) value = 0;
      liters = precision(liters + event.liters);
      value =
        value != null && event.netAmount != null
          ? precision(value + event.netAmount)
          : null;
      if (event.netAmount == null)
        issue = "ล็อตรับเข้ายังไม่มีต้นทุนสุทธิที่ยืนยัน";
      if (inRange) receivedLiters += event.liters;
    } else if (event.kind === "sale") {
      cost =
        average != null && liters + 1e-6 >= event.liters
          ? precision(average * event.liters)
          : null;
      originalCosts.set(event.id, cost != null ? cost / event.liters : null);
      liters = precision(liters - event.liters);
      value = cost != null && value != null ? precision(value - cost) : null;
      if (cost == null)
        issue =
          liters < 0
            ? "ลิตรขายเกินยอดคงเหลือในบัญชีต้นทุน"
            : "ต้นทุนก่อนขายยังไม่ครบ";
      if (liters === 0) value = 0;
    } else {
      const originalCost = event.originalItemId
        ? originalCosts.get(event.originalItemId)
        : null;
      cost =
        originalCost != null ? precision(-event.liters * originalCost) : null;
      liters = precision(liters + event.liters);
      value = value != null && cost != null ? precision(value - cost) : null;
      if (cost == null) issue = "ไม่พบต้นทุนรายการขายเดิมที่คืน";
    }
    if (inRange) {
      if (event.kind !== "receipt") {
        revenue += event.netAmount ?? 0;
        soldLiters += event.kind === "sale" ? event.liters : -event.liters;
        if (cost != null) costOfSales += cost;
      }
      if (issue) complete = false;
      rows.push({
        ...event,
        costOfSales: cost,
        profit:
          event.kind !== "receipt" && cost != null && event.netAmount != null
            ? precision(event.netAmount - cost)
            : null,
        balanceLiters: liters,
        balanceValue: value,
        averageCost:
          liters > 0 && value != null ? precision(value / liters) : null,
        issue,
      });
    }
  }
  if (!started) {
    openingLiters = liters;
    openingValue = value;
  }
  if (openingValue == null || value == null || liters < 0) complete = false;
  return {
    openingLiters,
    openingValue,
    closingLiters: liters,
    closingValue: value,
    averageCost: liters > 0 && value != null ? precision(value / liters) : null,
    soldLiters: precision(soldLiters),
    receivedLiters: precision(receivedLiters),
    revenue: money(revenue),
    costOfSales: complete ? money(costOfSales) : null,
    grossProfit: complete ? money(revenue - costOfSales) : null,
    complete,
    rows,
  };
}

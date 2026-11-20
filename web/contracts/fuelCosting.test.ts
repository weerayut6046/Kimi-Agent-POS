import { describe, expect, it } from "vitest";
import { calculateFuelCostLedger, type FuelCostEvent } from "./fuelCosting";

const opening = { at: "2026-11-01T00:00:00Z", liters: 2000, unitCost: 30 };
const from = opening.at;
const to = "2026-12-01T00:00:00Z";
const event = (
  id: string,
  day: number,
  kind: FuelCostEvent["kind"],
  liters: number,
  netAmount: number | null
): FuelCostEvent => ({
  id,
  at: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
  kind,
  liters,
  netAmount,
  reference: id,
});
const sequence = [
  event("r1", 2, "receipt", 3000, 96000),
  event("1", 3, "sale", 1000, 34000),
  event("2", 4, "sale", 1000, 33000),
  event("r2", 5, "receipt", 2000, 58000),
  event("3", 6, "sale", 1000, 32000),
];

describe("moving weighted-average fuel costs", () => {
  it("reproduces changing purchase and sale prices without a fixed margin", () => {
    const result = calculateFuelCostLedger(opening, sequence, from, to);
    expect(result.complete).toBe(true);
    expect(result.averageCost).toBe(30.32);
    expect(result.closingLiters).toBe(4000);
    expect(result.closingValue).toBe(121280);
    expect(result.grossProfit).toBe(6280);
    expect(result.rows.map(row => row.profit)).toEqual([
      null,
      2800,
      1800,
      null,
      1680,
    ]);
  });
  it("replays receipts before the selected range and sorts source events", () => {
    const result = calculateFuelCostLedger(
      opening,
      [...sequence].reverse(),
      "2026-11-04T00:00:00Z",
      to
    );
    expect(result.openingLiters).toBe(4000);
    expect(result.openingValue).toBe(124800);
    expect(result.grossProfit).toBe(3480);
    expect(result.rows).toHaveLength(3);
  });
  it("preserves a past margin when future deliveries are appended", () => {
    const cutoff = "2026-11-04T00:00:00Z";
    expect(calculateFuelCostLedger(opening, sequence, from, cutoff)).toEqual(
      calculateFuelCostLedger(opening, sequence.slice(0, 2), from, cutoff)
    );
  });
  it("reports negative margins", () => {
    const result = calculateFuelCostLedger(
      opening,
      [event("1", 2, "sale", 100, 2800)],
      from,
      to
    );
    expect(result.grossProfit).toBe(-200);
  });
  it("withholds profit for missing costs and stock shortages", () => {
    for (const input of [
      [event("r", 2, "receipt", 100, null), event("1", 3, "sale", 100, 3500)],
      [event("1", 2, "sale", 3000, 100000)],
    ]) {
      const result = calculateFuelCostLedger(opening, input, from, to);
      expect(result.complete).toBe(false);
      expect(result.grossProfit).toBeNull();
      expect(result.costOfSales).toBeNull();
    }
  });
  it("restores original sale cost on return after the average has changed", () => {
    const returned = {
      ...event("4", 7, "return", 500, -17000),
      originalItemId: "1",
    };
    const result = calculateFuelCostLedger(
      opening,
      [...sequence, returned],
      from,
      to
    );
    expect(result.rows.at(-1)?.costOfSales).toBe(-15600);
    expect(result.rows.at(-1)?.profit).toBe(-1400);
    expect(result.grossProfit).toBe(4880);
    expect(result.closingValue).toBe(136880);
  });
  it("withholds a whole-period result if the opening starts partway through", () => {
    expect(
      calculateFuelCostLedger(opening, sequence, "2026-10-31T00:00:00Z", to)
        .grossProfit
    ).toBeNull();
  });
});

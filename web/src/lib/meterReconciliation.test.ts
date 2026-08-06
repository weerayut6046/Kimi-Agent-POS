import { describe, expect, it } from "vitest";
import { assessMeterReading } from "@contracts/meterReconciliation";

describe("meter reading reconciliation", () => {
  it("flags the shifted P digit from the reported shift and suggests the likely value", () => {
    const result = assessMeterReading({
      openMeter: 397_079.76,
      closeMeter: 397_747.15,
      openMoney: 8_478_563.1,
      closeMoney: 8_904_372.5,
      pricePerLiter: 38.69,
    });

    expect(result).toMatchObject({
      liters: 667.39,
      amountFromLiters: 25_821.32,
      moneyFromMeter: 425_809.4,
      difference: 399_988.08,
      implausible: true,
      suggestedCloseMoney: 8_504_372.5,
    });
  });

  it("allows normal accumulated meter rounding differences", () => {
    const result = assessMeterReading({
      openMeter: 904_193.58,
      closeMeter: 906_220.31,
      openMoney: 1_030_241.6,
      closeMoney: 1_104_591.6,
      pricePerLiter: 36.69,
    });

    expect(result.difference).toBe(-10.72);
    expect(result.implausible).toBe(false);
    expect(result.suggestedCloseMoney).toBeNull();
  });

  it("does not reject comparisons when the fuel price changed during the shift", () => {
    const result = assessMeterReading({
      openMeter: 100,
      closeMeter: 200,
      openMoney: 1_000,
      closeMoney: 6_000,
      pricePerLiter: 40,
      priceChangedDuringShift: true,
    });

    expect(result.difference).toBe(1_000);
    expect(result.implausible).toBe(false);
  });

  it("does not count a closing P value when the shift has no opening P baseline", () => {
    const result = assessMeterReading({
      openMeter: 100,
      closeMeter: 110,
      openMoney: 0,
      closeMoney: 5_000,
      pricePerLiter: 40,
    });

    expect(result.moneyFromMeter).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.implausible).toBe(false);
  });
});

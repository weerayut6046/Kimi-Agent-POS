import { describe, expect, it } from "vitest";
import { getHistoryReadingPreview } from "./shiftHistoryPreview";

const firstShiftReading = {
  openMeter: 0,
  closeMeter: "10",
  openMoney: 0,
  closeMoney: "400",
  pricePerLiter: 40,
};

describe("shift history reading preview", () => {
  it("counts a first shift from zero P for both creation and later edits", () => {
    expect(getHistoryReadingPreview([firstShiftReading])).toEqual({
      totalLiters: 10,
      totalAmount: 400,
      totalMoneyMeter: 400,
      valid: true,
    });
    expect(
      getHistoryReadingPreview([
        { ...firstShiftReading, openMeter: "0", openMoney: "0" },
      ])
    ).toEqual(getHistoryReadingPreview([firstShiftReading]));
  });

  it("includes zero-opening and carried-over P readings in the same total", () => {
    expect(
      getHistoryReadingPreview([
        firstShiftReading,
        {
          openMeter: 100,
          closeMeter: "110.125",
          openMoney: 1_000,
          closeMoney: "1405.15",
          pricePerLiter: 40,
        },
      ])
    ).toEqual({
      totalLiters: 20.125,
      totalAmount: 805,
      totalMoneyMeter: 805.15,
      valid: true,
    });
  });

  it("accepts an explicitly recorded zero sale", () => {
    expect(
      getHistoryReadingPreview([
        { ...firstShiftReading, closeMeter: "0", closeMoney: "0" },
      ])
    ).toEqual({
      totalLiters: 0,
      totalAmount: 0,
      totalMoneyMeter: 0,
      valid: true,
    });
  });

  it("requires a missing legacy closing P to be supplied before recalculating", () => {
    expect(
      getHistoryReadingPreview([{ ...firstShiftReading, closeMoney: "" }])
        ?.valid
    ).toBe(false);
    expect(
      getHistoryReadingPreview([{ ...firstShiftReading, openMoney: "" }])?.valid
    ).toBe(false);
    expect(getHistoryReadingPreview(null)).toBeNull();
    expect(getHistoryReadingPreview([])).toBeNull();
  });

  it("rejects a closing P below its zero baseline or a nonfinite value", () => {
    for (const closeMoney of ["-1", "Infinity", "invalid"]) {
      expect(
        getHistoryReadingPreview([{ ...firstShiftReading, closeMoney }])?.valid
      ).toBe(false);
    }
  });
});

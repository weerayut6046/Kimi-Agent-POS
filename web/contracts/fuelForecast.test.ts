import { describe, expect, it } from "vitest";
import {
  DEFAULT_FUEL_FORECAST_SETTINGS,
  fuelForecastSaveSettingsSchema,
  fuelForecastSummaryInputSchema,
  normalizeFuelForecastConfig,
} from "./fuelForecast";

describe("fuel forecast contract", () => {
  it("normalizes branch JSON without accepting malformed or unsafe policies", () => {
    expect(normalizeFuelForecastConfig("not json")).toEqual({});
    expect(normalizeFuelForecastConfig("[]")).toEqual({});
    expect(
      normalizeFuelForecastConfig(
        JSON.stringify({
          12: DEFAULT_FUEL_FORECAST_SETTINGS,
          13: { leadTimeDays: 60, safetyStockDays: 30, targetCoverDays: 90 },
          14: { leadTimeDays: -1, safetyStockDays: 2, targetCoverDays: 7 },
          15: { leadTimeDays: "2", safetyStockDays: 2, targetCoverDays: 7 },
          "wrong-key": DEFAULT_FUEL_FORECAST_SETTINGS,
          "01": DEFAULT_FUEL_FORECAST_SETTINGS,
        })
      )
    ).toEqual({ 12: DEFAULT_FUEL_FORECAST_SETTINGS });
  });
  it("requires delivery cover to exceed the reorder point", () => {
    expect(
      fuelForecastSaveSettingsSchema.safeParse({
        tankId: 1,
        leadTimeDays: 2,
        safetyStockDays: 2,
        targetCoverDays: 4,
      }).success
    ).toBe(false);
    expect(
      fuelForecastSaveSettingsSchema.safeParse({
        tankId: 1,
        leadTimeDays: 0,
        safetyStockDays: 0,
        targetCoverDays: 1,
      }).success
    ).toBe(true);
    expect(
      fuelForecastSaveSettingsSchema.safeParse({
        tankId: 0,
        ...DEFAULT_FUEL_FORECAST_SETTINGS,
      }).success
    ).toBe(false);
  });
  it("defaults to 30 completed days and restricts supported windows", () => {
    expect(fuelForecastSummaryInputSchema.parse(undefined)).toEqual({
      lookbackDays: 30,
    });
    expect(fuelForecastSummaryInputSchema.parse({})).toEqual({
      lookbackDays: 30,
    });
    expect(
      fuelForecastSummaryInputSchema.safeParse({ lookbackDays: 29 }).success
    ).toBe(false);
    expect(fuelForecastSummaryInputSchema.parse({ lookbackDays: 7 })).toEqual({
      lookbackDays: 7,
    });
  });
});

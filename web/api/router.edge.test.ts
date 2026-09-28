import { describe, expect, it } from "vitest";
import { edgeAppRouter } from "./router.edge";

describe("Supabase Edge API router", () => {
  it("registers every business setup procedure in the Edge deployment", () => {
    expect(Object.keys(edgeAppRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        "initialSetup.state",
        "initialSetup.createOwner",
        "onboarding.state",
        "onboarding.saveProfile",
        "onboarding.savePayments",
        "onboarding.saveSystemSettings",
        "onboarding.confirmStep",
        "onboarding.createFuelSetup",
        "onboarding.updateEquipment",
        "onboarding.complete",
      ])
    );
  });
  it("registers fuel forecasting and its settings procedure", () => {
    expect(Object.keys(edgeAppRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        "fuelForecast.summary",
        "fuelForecast.saveSettings",
      ])
    );
  });
  it("registers every security procedure used by the dashboard", () => {
    expect(Object.keys(edgeAppRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        "security.overview",
        "security.events",
        "security.scan",
        "security.analyze",
        "security.reports",
        "security.setEventStatus",
      ])
    );
  });
});

import { describe, expect, it } from "vitest";
import { getApiMenuPermissions } from "@contracts/menuPermissions";
import { appRouter } from "./router";
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

// Pre-login handlers have their own credentials, bootstrap or public lookup
// rules. Other procedures must reject calls with no staff session.
const preLogin = [
  "auth.deploymentInfo",
  "auth.reportLoginAttempt",
  "initialSetup.createOwner",
  "initialSetup.state",
  "membership.customerPoints",
  "ping",
  "staffAuth.beginPasskeyLogin",
  "staffAuth.completePasskeyLogin",
  "staffAuth.loginWithPin",
  "staffAuth.passkeyStatus",
];

const nodePaths = Object.keys(appRouter._def.procedures).sort();
const edgePaths = Object.keys(edgeAppRouter._def.procedures).sort();

describe("API authorization coverage", () => {
  it("keeps the Node and Edge registrations in sync", () => {
    expect(edgePaths).toEqual(nodePaths);
  });

  it("leaves menu checks optional only on public, session and shared utility paths", () => {
    expect(
      nodePaths.filter(path => getApiMenuPermissions(path).length === 0)
    ).toEqual([
      "assistant.chat",
      "assistant.executeAction",
      "auth.currentStaff",
      "auth.deploymentInfo",
      "auth.listBranches",
      "auth.realtimeSession",
      "auth.reportLoginAttempt",
      "auth.switchBranch",
      "auth.systemAccess",
      "catalog.getSettings",
      "catalog.getShopLogo",
      "ping",
      "pos.currentShift",
      "staffAuth.beginPasskeyLogin",
      "staffAuth.completePasskeyLogin",
      "staffAuth.loginWithPin",
      "staffAuth.passkeyStatus",
    ]);
  });

  it.each([
    ["Node", appRouter],
    ["Edge", edgeAppRouter],
  ] as const)(
    "%s rejects anonymous calls outside the pre-login allowlist",
    async (_name, router) => {
      const caller = router.createCaller({
        req: new Request("http://test.local/api"),
        resHeaders: new Headers(),
      });
      for (const path of nodePaths.filter(path => !preLogin.includes(path))) {
        const procedure = path
          .split(".")
          .reduce<unknown>(
            (current, key) => (current as Record<string, unknown>)[key],
            caller
          ) as () => Promise<unknown>;
        const code = path.startsWith("platform.")
          ? "FORBIDDEN"
          : "UNAUTHORIZED";
        await expect(procedure(), path).rejects.toMatchObject({ code });
      }
    }
  );
});

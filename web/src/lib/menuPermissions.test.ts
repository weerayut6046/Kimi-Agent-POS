import { describe, expect, it } from "vitest";
import {
  MENU_PERMISSION_KEYS,
  getApiMenuPermissions,
  getFirstAllowedMenuPath,
  getRoleMenuPermissions,
  hasMenuPermission,
  normalizeMenuPermissions,
} from "@contracts/menuPermissions";

describe("menu permissions", () => {
  it("keeps legacy users on the previous role defaults", () => {
    expect(normalizeMenuPermissions("cashier", null)).toEqual(
      getRoleMenuPermissions("cashier")
    );
    expect(hasMenuPermission("cashier", null, "documents")).toBe(false);
    expect(hasMenuPermission("manager", null, "documents")).toBe(true);
    expect(hasMenuPermission("cashier", null, "profitability")).toBe(false);
    expect(hasMenuPermission("manager", null, "profitability")).toBe(true);
    expect(hasMenuPermission("cashier", null, "settings")).toBe(true);
    expect(hasMenuPermission("manager", null, "settings")).toBe(true);
  });

  it("always grants every menu to admins", () => {
    expect(getRoleMenuPermissions("admin")).toEqual(MENU_PERMISSION_KEYS);
    expect(normalizeMenuPermissions("admin", ["pos"])).toEqual(
      MENU_PERMISSION_KEYS
    );
  });

  it("keeps owner setup administrator-only for legacy and stored permissions", () => {
    expect(hasMenuPermission("admin", [], "setup")).toBe(true);
    for (const role of ["cashier", "manager"] as const) {
      expect(getRoleMenuPermissions(role)).not.toContain("setup");
      expect(normalizeMenuPermissions(role, null)).not.toContain("setup");
      expect(normalizeMenuPermissions(role, ["pos", "setup", "setup"])).toEqual(
        ["pos"]
      );
    }
    expect(getFirstAllowedMenuPath("admin", [])).toBe("/");
  });

  it.each([
    "initialSetup.state",
    "initialSetup.createOwner",
    "initialSetup.futureFeature",
    "onboarding.state",
    "onboarding.saveProfile",
    "onboarding.savePayments",
    "onboarding.saveSystemSettings",
    "onboarding.confirmStep",
    "onboarding.complete",
    "onboarding.createFuelSetup",
    "onboarding.updateEquipment",
    "onboarding.futureFeature",
  ])(
    "automatically protects setup API %s through its central permission",
    path => {
      expect(getApiMenuPermissions(path)).toEqual(["setup"]);
    }
  );

  it("registers SaaS administration only for admins and preserves the role ceiling", () => {
    expect(hasMenuPermission("admin", [], "platform")).toBe(true);
    for (const role of ["manager", "cashier"] as const) {
      expect(hasMenuPermission(role, null, "platform")).toBe(false);
      expect(normalizeMenuPermissions(role, ["platform", "pos"])).toEqual([
        "pos",
      ]);
    }
    expect(getApiMenuPermissions("platform.overview")).toEqual(["platform"]);
    expect(getApiMenuPermissions("platform.futureFeature")).toEqual([
      "platform",
    ]);
    expect(getApiMenuPermissions("auth.deploymentInfo")).toEqual([]);
  });

  it.each([
    ["cashier", false],
    ["manager", true],
    ["admin", true],
  ] as const)(
    "preserves table module defaults and the %s profitability ceiling",
    (role, canViewProfitability) => {
      expect(getRoleMenuPermissions(role)).toEqual(
        expect.arrayContaining([
          "customers",
          "settings",
          "stock",
          "fuel_forecast",
          "workforce",
        ])
      );
      expect(hasMenuPermission(role, null, "profitability")).toBe(
        canViewProfitability
      );
      expect(
        normalizeMenuPermissions(role, [
          "customers",
          "settings",
          "profitability",
        ]).includes("profitability")
      ).toBe(canViewProfitability);
    }
  );

  it("filters unknown and role-ineligible menu keys", () => {
    expect(
      normalizeMenuPermissions("cashier", [
        "pos",
        "audit",
        "reports",
        "unknown",
      ])
    ).toEqual(["pos"]);
    expect(normalizeMenuPermissions("cashier", ["settings", "audit"])).toEqual([
      "settings",
    ]);
    expect(hasMenuPermission("cashier", ["pos"], "settings")).toBe(false);
  });

  it.each(["cashier", "manager", "admin"] as const)(
    "grants fuel planning to existing %s users by default",
    role => {
      expect(hasMenuPermission(role, null, "fuel_forecast")).toBe(true);
      expect(hasMenuPermission(role, undefined, "fuel_forecast")).toBe(true);
      expect(
        normalizeMenuPermissions(role, ["fuel_forecast", "fuel_forecast"])
      ).toContain("fuel_forecast");
    }
  );

  it.each(["cashier", "manager"] as const)(
    "keeps explicit fuel planning grants separate from stock for %s users",
    role => {
      expect(
        normalizeMenuPermissions(role, [
          "fuel_forecast",
          "fuel_forecast",
          "unknown",
        ])
      ).toEqual(["fuel_forecast"]);
      expect(hasMenuPermission(role, ["stock"], "fuel_forecast")).toBe(false);
      expect(hasMenuPermission(role, ["fuel_forecast"], "stock")).toBe(false);
      expect(getFirstAllowedMenuPath(role, ["fuel_forecast"])).toBe(
        "/stock/forecast"
      );
    }
  );

  it("uses the first explicitly allowed menu as the landing page", () => {
    expect(getFirstAllowedMenuPath("cashier", ["stock", "pos"])).toBe("/pos");
    expect(getFirstAllowedMenuPath("cashier", [])).toBeNull();
  });

  it("automatically applies a module permission to new API procedures", () => {
    expect(getApiMenuPermissions("workforce.futureFeature")).toEqual([
      "workforce",
    ]);
    expect(getApiMenuPermissions("membership.futureFeature")).toEqual([
      "members",
    ]);
    expect(getApiMenuPermissions("stockCount.futureFeature")).toEqual([
      "stock",
    ]);
    expect(getApiMenuPermissions("fuelForecast.futureFeature")).toEqual([
      "fuel_forecast",
    ]);
  });

  it.each(["fuelForecast.summary", "fuelForecast.saveSettings"])(
    "maps fuel planning API %s to its own permission",
    path => {
      expect(getApiMenuPermissions(path)).toEqual(["fuel_forecast"]);
    }
  );

  it.each([
    ["customers.list", ["customers"]],
    ["customers.create", ["customers"]],
    ["customers.update", ["customers"]],
    ["customers.remove", ["customers"]],
    ["catalog.listProducts", ["pos", "stock", "sales", "settings"]],
    ["catalog.createProduct", ["settings"]],
    ["catalog.updateProduct", ["settings"]],
    ["catalog.deleteProduct", ["settings"]],
    ["catalog.reorderProducts", ["settings"]],
  ] as const)(
    "maps table API %s to its existing modules",
    (path, permissions) => {
      expect(getApiMenuPermissions(path)).toEqual(permissions);
    }
  );

  // Staff reads serve several modules. Access configuration and staff mutations
  // retain their server-side adminQuery guard and admins always have every menu.
  it.each([
    "auth.currentStaff",
    "auth.listStaff",
    "auth.listStaffAccess",
    "auth.createStaff",
    "auth.updateStaff",
    "auth.deleteStaff",
  ])("keeps shared staff API %s outside module-specific mappings", path => {
    expect(getApiMenuPermissions(path)).toEqual([]);
  });

  it("maps shared routers to every feature that legitimately consumes them", () => {
    expect(getApiMenuPermissions("faceAuth.passkeyStatus")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.beginFaceLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.completeFaceLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.beginPasskeyLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.completePasskeyLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.beginPasskeyRegistration")).toEqual([
      "settings",
    ]);
    expect(
      getApiMenuPermissions("faceAuth.completePasskeyRegistration")
    ).toEqual(["settings"]);
    expect(getApiMenuPermissions("faceAuth.enrollFace")).toEqual(["workforce"]);
    expect(getApiMenuPermissions("faceAuth.deleteFaceProfile")).toEqual([
      "workforce",
    ]);
    expect(getApiMenuPermissions("faceAuth.futureFeature")).toEqual([
      "workforce",
    ]);
    expect(getApiMenuPermissions("pos.dashboard")).toEqual(["dashboard"]);
    expect(getApiMenuPermissions("pos.deleteSale")).toEqual(["sales"]);
    expect(getApiMenuPermissions("payments.promptpayQr")).toEqual([
      "pos",
      "sales",
      "settings",
    ]);
    expect(getApiMenuPermissions("catalog.getSettings")).toEqual([]);
    expect(getApiMenuPermissions("catalog.updateTheme")).toEqual(["settings"]);
    expect(getApiMenuPermissions("catalog.updateTemplate")).toEqual([
      "settings",
    ]);
    expect(getApiMenuPermissions("catalog.lowStockAlerts")).toEqual(["stock"]);
    expect(getApiMenuPermissions("catalog.futureManagementFeature")).toEqual([
      "settings",
    ]);
    expect(getApiMenuPermissions("pos.currentShift")).toEqual([]);
    expect(getApiMenuPermissions("reports.profitability")).toEqual([
      "profitability",
    ]);
    expect(getApiMenuPermissions("reports.exportDailyExcel")).toEqual([
      "profitability",
    ]);
    expect(getApiMenuPermissions("reports.exportRangeExcel")).toEqual([
      "profitability",
    ]);
    expect(getApiMenuPermissions("reports.daily")).toEqual([
      "dashboard",
      "sales",
      "profitability",
    ]);
    expect(getApiMenuPermissions("reports.fuelStockSummary")).toEqual([
      "stock",
    ]);
    expect(getApiMenuPermissions("reports.tankReconciliation")).toEqual([
      "stock",
    ]);
    expect(getApiMenuPermissions("audit.createFormulaAuditFixPlan")).toEqual([
      "audit",
    ]);
    expect(getApiMenuPermissions("catalog.listTanks")).toEqual([
      "stock",
      "settings",
    ]);
  });
});

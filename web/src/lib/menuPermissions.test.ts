import { describe, expect, it } from "vitest";
import {
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
  });

  it("always grants every menu to admins", () => {
    expect(normalizeMenuPermissions("admin", ["pos"])).toEqual(
      getRoleMenuPermissions("admin")
    );
  });

  it("filters unknown and role-ineligible menu keys", () => {
    expect(
      normalizeMenuPermissions("cashier", ["pos", "audit", "unknown"])
    ).toEqual(["pos"]);
  });

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
  });

  it("maps shared routers to every feature that legitimately consumes them", () => {
    expect(getApiMenuPermissions("faceAuth.beginFaceLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.completeFaceLogin")).toEqual([]);
    expect(getApiMenuPermissions("faceAuth.enrollFace")).toEqual(["workforce"]);
    expect(getApiMenuPermissions("faceAuth.deleteFaceProfile")).toEqual(["workforce"]);
    expect(getApiMenuPermissions("faceAuth.futureFeature")).toEqual(["workforce"]);
    expect(getApiMenuPermissions("pos.dashboard")).toEqual(["dashboard"]);
    expect(getApiMenuPermissions("pos.deleteSale")).toEqual(["sales"]);
    expect(getApiMenuPermissions("payments.promptpayQr")).toEqual([
      "pos",
      "sales",
      "settings",
    ]);
    expect(getApiMenuPermissions("catalog.getSettings")).toEqual([]);
    expect(getApiMenuPermissions("catalog.lowStockAlerts")).toEqual(["stock"]);
    expect(getApiMenuPermissions("catalog.futureManagementFeature")).toEqual([
      "settings",
    ]);
    expect(getApiMenuPermissions("pos.currentShift")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
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
});

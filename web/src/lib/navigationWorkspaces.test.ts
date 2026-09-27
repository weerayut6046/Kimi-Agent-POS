import { describe, expect, it } from "vitest";
import {
  getBusinessLandingPath,
  isPosWorkspacePath,
} from "./navigationWorkspaces";

describe("business workspaces", () => {
  it("starts a cashier at the permitted point of sale", () => {
    expect(getBusinessLandingPath("cashier", null)).toBe("/pos");
    expect(getBusinessLandingPath("cashier", ["sales", "pos"])).toBe("/pos");
  });

  it("respects restricted menus when selecting a landing page", () => {
    expect(getBusinessLandingPath("cashier", ["shifts"])).toBe("/shifts");
    expect(getBusinessLandingPath("cashier", [])).toBeNull();
    expect(getBusinessLandingPath("manager", ["stock"])).toBe("/stock");
  });

  it("keeps business administrators on their dashboard", () => {
    expect(getBusinessLandingPath("admin", null)).toBe("/");
    expect(getBusinessLandingPath("manager", null)).toBe("/");
  });

  it("groups only sales operations under the point of sale", () => {
    expect(isPosWorkspacePath("/pos")).toBe(true);
    expect(isPosWorkspacePath("/shifts/12")).toBe(true);
    expect(isPosWorkspacePath("/sales")).toBe(true);
    expect(isPosWorkspacePath("/stock")).toBe(false);
    expect(isPosWorkspacePath("/platform")).toBe(false);
    expect(isPosWorkspacePath("/sales-other")).toBe(false);
  });
});

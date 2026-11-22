import { describe, expect, it } from "vitest";
import {
  BUSINESS_ACTIONS,
  BUSINESS_ROLE_LABELS,
  canPerformBusinessAction,
} from "./businessPermissions";

describe("business action permissions", () => {
  it("denies anonymous and unknown roles/actions", () => {
    expect(canPerformBusinessAction(null, "meter.create")).toBe(false);
    expect(canPerformBusinessAction("superadmin", "cost.read")).toBe(false);
    expect(canPerformBusinessAction("admin", "nonexistent.action")).toBe(false);
    expect(canPerformBusinessAction("__proto__", "cost.read")).toBe(false);
  });

  it("restricts financial and audit reads to owner", () => {
    for (const action of ["cost.read", "profit.read", "audit.read"]) {
      expect(canPerformBusinessAction("admin", action)).toBe(true);
      expect(canPerformBusinessAction("manager", action)).toBe(false);
      expect(canPerformBusinessAction("cashier", action)).toBe(false);
    }
  });

  it("prevents staff from approving or requesting closing adjustments", () => {
    expect(canPerformBusinessAction("cashier", "closing.approve")).toBe(false);
    expect(canPerformBusinessAction("cashier", "closing.adjust.request")).toBe(false);
    expect(canPerformBusinessAction("manager", "closing.approve")).toBe(true);
    expect(canPerformBusinessAction("manager", "closing.adjust.request")).toBe(true);
  });

  it("limits staff management to privileged roles", () => {
    expect(canPerformBusinessAction("admin", "users.manage_staff")).toBe(true);
    expect(canPerformBusinessAction("manager", "users.manage_staff")).toBe(true);
    expect(canPerformBusinessAction("cashier", "users.manage_staff")).toBe(false);
  });

  it("permits operational actions for all three roles", () => {
    for (const role of ["admin", "manager", "cashier"]) {
      expect(canPerformBusinessAction(role, "meter.create")).toBe(true);
      expect(canPerformBusinessAction(role, "shift.submit")).toBe(true);
    }
  });

  it("has a unique action catalog and backward-compatible role labels", () => {
    expect(new Set(BUSINESS_ACTIONS).size).toBe(BUSINESS_ACTIONS.length);
    expect(BUSINESS_ROLE_LABELS).toEqual({
      admin: "Owner",
      manager: "Manager",
      cashier: "Staff",
    });
  });
});

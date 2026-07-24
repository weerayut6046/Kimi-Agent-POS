import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("staff menu permissions", () => {
  it("returns role defaults for existing users", async () => {
    const session = await t.anonymousCaller().auth.login({
      username: "somchai",
      pin: "0000",
    });

    expect(session.menuPermissions).toContain("pos");
    expect(session.menuPermissions).not.toContain("audit");
  });

  it("lets an admin persist permissions and refreshes the active session", async () => {
    await t.caller("admin").auth.updateStaff({
      id: 3,
      menuPermissions: ["pos", "shifts"],
    });

    const staff = await t.caller("admin").auth.listStaffAccess();
    expect(staff.find(user => user.id === 3)?.menuPermissions).toEqual([
      "pos",
      "shifts",
    ]);

    const current = await t
      .caller("cashier", 3)
      .auth.currentStaff();
    expect(current.authenticated).toBe(true);
    if (current.authenticated) {
      expect(current.menuPermissions).toEqual(["pos", "shifts"]);
    }
  });

  it("inherits menu permissions from an assigned access group", async () => {
    const initialGroups = await t.caller("admin").auth.listAccessGroups();
    expect(initialGroups.map(group => group.name)).toEqual(
      expect.arrayContaining(["พนักงาน", "ผู้จัดการ"])
    );

    const created = await t.caller("admin").auth.createAccessGroup({
      name: "พนักงานทดสอบ",
      description: "ใช้สำหรับ integration test",
      role: "cashier",
      menuPermissions: ["pos", "stock"],
    });
    await t.caller("admin").auth.updateStaff({
      id: 3,
      accessGroupId: created.id,
    });

    const staff = await t.caller("admin").auth.listStaffAccess();
    const cashier = staff.find(user => user.id === 3);
    expect(cashier?.accessGroup).toEqual({
      id: created.id,
      name: "พนักงานทดสอบ",
    });
    expect(cashier?.menuPermissions).toEqual(["pos", "stock"]);

    await t.caller("admin").auth.updateAccessGroup({
      id: created.id,
      menuPermissions: ["reports"],
    });
    const refreshed = await t
      .caller("cashier", 3)
      .auth.currentStaff();
    expect(refreshed.authenticated).toBe(true);
    if (refreshed.authenticated) {
      expect(refreshed.menuPermissions).toEqual(["reports"]);
      expect(refreshed.accessGroup?.name).toBe("พนักงานทดสอบ");
    }

    const managerGroup = initialGroups.find(group => group.role === "manager");
    await expect(
      t.caller("admin").auth.updateStaff({
        id: 3,
        accessGroupId: managerGroup?.id,
      })
    ).rejects.toThrow("กลุ่มสิทธิ์ไม่ตรงกับระดับผู้ใช้");

    await t.caller("admin").auth.deleteAccessGroup({ id: created.id });
    const fallback = await t
      .caller("cashier", 3)
      .auth.currentStaff();
    expect(fallback.authenticated).toBe(true);
    if (fallback.authenticated) {
      expect(fallback.accessGroup).toBeNull();
      expect(fallback.menuPermissions).toEqual(["pos", "shifts"]);
    }
  });

  it("does not expose access configuration to non-admin users", async () => {
    const publicStaff = await t.caller().auth.listStaff();
    expect(publicStaff.some(user => "menuPermissions" in user)).toBe(false);
    expect(publicStaff.some(user => "supabaseAuthUserId" in user)).toBe(false);

    const adminStaff = await t.caller("admin").auth.listStaffAccess();
    expect(adminStaff.some(user => "supabaseAuthUserId" in user)).toBe(false);

    await expect(t.caller("cashier").auth.listStaffAccess()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );
    await expect(t.caller("cashier").auth.listAccessGroups()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );

    await expect(t.caller("cashier", 3).auth.currentStaff()).resolves.toMatchObject({
      authenticated: true,
      id: 3,
    });
  });

  it("uses HTTP-compatible auth error codes for expired or insufficient sessions", async () => {
    await expect(
      t.anonymousCaller().auth.listAccessGroups()
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      t.caller("cashier").auth.listAccessGroups()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.anonymousCaller().workforce.scheduleList({
        startDate: "2026-07-22",
        endDate: "2026-07-28",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps the staged Realtime bridge optional when Supabase keys are absent", async () => {
    await expect(
      t.caller("cashier").auth.realtimeSession()
    ).resolves.toBeNull();
    await expect(
      t.anonymousCaller().auth.realtimeSession()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

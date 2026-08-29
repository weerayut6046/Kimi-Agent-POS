import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { shifts, workSchedules } from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

beforeEach(async () => {
  await test.db.delete(workSchedules);
  await test.db.delete(shifts);
});

afterAll(() => test.cleanup());

async function openShiftFor(staffId: number, staffName: string) {
  const [shift] = await test.db
    .insert(shifts)
    .values({
      branchId: 1,
      staffId,
      staffName,
      status: "open",
    })
    .returning();
  return shift!;
}

describe("system access while a POS shift is active", () => {
  it("allows a cashier when no shift is active", async () => {
    await expect(
      test.caller("cashier", 3).auth.systemAccess()
    ).resolves.toMatchObject({
      allowed: true,
      reason: "no_active_shift",
    });
  });

  it("blocks another unscheduled cashier at both status and business API layers", async () => {
    await openShiftFor(2, "สมหญิง (ผู้จัดการสาขา)");

    const access = await test.caller("cashier", 3).auth.systemAccess();
    expect(access).toMatchObject({
      allowed: false,
      reason: "active_shift_locked",
      hasWorkSchedule: false,
      activeShift: { staffName: "สมหญิง (ผู้จัดการสาขา)" },
    });
    await expect(
      test.caller("cashier", 3).catalog.listProducts()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("always allows manager and admin roles", async () => {
    await openShiftFor(3, "สมชาย (พนักงาน)");

    await expect(
      test.caller("manager", 2).auth.systemAccess()
    ).resolves.toMatchObject({ allowed: true, reason: "role_exempt" });
    await expect(
      test.caller("admin", 1).catalog.listProducts()
    ).resolves.toBeDefined();
  });

  it("allows a cashier assigned to work today but not leave or absent", async () => {
    await openShiftFor(2, "สมหญิง (ผู้จัดการสาขา)");
    const template = await test.db.query.workShiftTemplates.findFirst();
    const [schedule] = await test.db
      .insert(workSchedules)
      .values({
        branchId: 1,
        workDate: bangkokDateKey(new Date()),
        shiftTemplateId: template!.id,
        staffId: 3,
        status: "leave",
      })
      .returning();

    await expect(
      test.caller("cashier", 3).auth.systemAccess()
    ).resolves.toMatchObject({ allowed: false });

    await test.db
      .update(workSchedules)
      .set({ status: "scheduled" })
      .where(eq(workSchedules.id, schedule!.id));

    await expect(
      test.caller("cashier", 3).auth.systemAccess()
    ).resolves.toMatchObject({
      allowed: true,
      reason: "scheduled_today",
      hasWorkSchedule: true,
    });
    await expect(
      test.caller("cashier", 3).catalog.listProducts()
    ).resolves.toBeDefined();
  });

  it("allows the owner of the active shift without a work schedule", async () => {
    await openShiftFor(3, "สมชาย (พนักงาน)");

    await expect(
      test.caller("cashier", 3).auth.systemAccess()
    ).resolves.toMatchObject({
      allowed: true,
      reason: "active_shift_owner",
      hasWorkSchedule: false,
    });
  });
});

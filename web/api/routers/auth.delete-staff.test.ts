import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  assistantActionProposals,
  employeeProfiles,
  payrollRecords,
  staffUsers,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

async function insertStaff(username: string, name: string): Promise<number> {
  const [row] = await test.db
    .insert(staffUsers)
    .values({ username, pin: "test-only", name, role: "cashier" })
    .returning({ id: staffUsers.id });
  return row.id;
}

describe("auth.deleteStaff", () => {
  it("ห้ามลบบัญชีตัวเอง", async () => {
    await expect(
      test.caller("admin").auth.deleteStaff({ id: 1 })
    ).rejects.toThrow("ลบบัญชีตัวเองไม่ได้");
  });

  it("ลบพนักงานที่มีประวัติเงินเดือนไม่ได้ และแนะนำให้ปิดใช้งานแทน", async () => {
    const staffId = await insertStaff("payrollstaff", "มีเงินเดือน");
    await test.db
      .insert(payrollRecords)
      .values({ staffId, payrollMonth: "2026-07" });

    await expect(
      test.caller("admin").auth.deleteStaff({ id: staffId })
    ).rejects.toThrow("มีประวัติเงินเดือนแล้ว");

    // บัญชีและประวัติเงินเดือนต้องยังอยู่ครบ
    const staff = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, staffId),
    });
    expect(staff?.name).toBe("มีเงินเดือน");
    const payroll = await test.db.query.payrollRecords.findFirst({
      where: eq(payrollRecords.staffId, staffId),
    });
    expect(payroll).toBeTruthy();
  });

  it("ลบพนักงานที่ไม่มีเงินเดือนได้ พร้อม cascade โปรไฟล์และลบประวัติคำสั่ง AI", async () => {
    const staffId = await insertStaff("cleanstaff", "ไม่มีเงินเดือน");
    await test.db
      .insert(employeeProfiles)
      .values({ staffId, position: "พนักงานหน้าลาน" });
    await test.db.insert(assistantActionProposals).values({
      branchId: 1,
      staffId,
      idempotencyKey: `test-${staffId}`,
      action: "test_action",
      payload: {},
      title: "ทดสอบ",
      summary: "ทดสอบ",
      risk: "standard",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await test
      .caller("admin")
      .auth.deleteStaff({ id: staffId });
    expect(result).toEqual({ ok: true });

    const staff = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, staffId),
    });
    expect(staff).toBeUndefined();
    const profile = await test.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.staffId, staffId),
    });
    expect(profile).toBeUndefined();
    const proposal = await test.db.query.assistantActionProposals.findFirst({
      where: eq(assistantActionProposals.staffId, staffId),
    });
    expect(proposal).toBeUndefined();
  });
});

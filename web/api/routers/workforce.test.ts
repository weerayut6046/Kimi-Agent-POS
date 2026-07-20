import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { payrollRecords, workSchedules } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

describe("workforce router", () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await setupTestDb();
  });

  afterAll(() => test.cleanup());

  it("seeds standard shift templates", async () => {
    const templates = await test.caller("cashier", 3).workforce.listTemplates();
    expect(templates.map(template => template.name)).toEqual([
      "กะเช้า",
      "กะบ่าย",
      "กะดึก",
    ]);
  });

  it("allows only admin to maintain employee pay profiles", async () => {
    await expect(
      test.caller("manager", 2).workforce.upsertEmployeeProfile({
        staffId: 3,
        position: "พนักงานหน้าลาน",
        salaryType: "daily",
        baseRate: 500,
        overtimeRate: 80,
      })
    ).rejects.toThrow();

    await test.caller("admin", 1).workforce.upsertEmployeeProfile({
      staffId: 3,
      position: "พนักงานหน้าลาน",
      salaryType: "daily",
      baseRate: 500,
      overtimeRate: 80,
      hireDate: "2026-01-10",
    });
    const profiles = await test.caller("admin", 1).workforce.employeeProfiles();
    expect(profiles.find(profile => profile.staffId === 3)).toMatchObject({
      position: "พนักงานหน้าลาน",
      salaryType: "daily",
      baseRate: 500,
    });
  });

  it("creates schedules, limits staff visibility, and swaps two assignments", async () => {
    const templates = await test.caller("admin", 1).workforce.listTemplates();
    const morning = templates.find(template => template.name === "กะเช้า")!;
    const afternoon = templates.find(template => template.name === "กะบ่าย")!;

    const first = await test.caller("admin", 1).workforce.createSchedule({
      workDate: "2026-07-05",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "scheduled",
    });
    const second = await test.caller("admin", 1).workforce.createSchedule({
      workDate: "2026-07-05",
      shiftTemplateId: afternoon.id,
      staffId: 2,
      status: "scheduled",
    });
    await test.caller("admin", 1).workforce.createSchedule({
      workDate: "2026-07-06",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "completed",
    });

    const ownBefore = await test.caller("cashier", 3).workforce.scheduleList({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    expect(ownBefore).toHaveLength(2);
    expect(ownBefore.every(schedule => schedule.staffId === 3)).toBe(true);

    await test.caller("admin", 1).workforce.swapSchedules({
      firstId: first.id,
      secondId: second.id,
    });
    const swapped = await test.db.query.workSchedules.findMany({
      where: and(eq(workSchedules.workDate, "2026-07-05")),
    });
    expect(swapped.find(schedule => schedule.id === first.id)?.staffId).toBe(2);
    expect(swapped.find(schedule => schedule.id === second.id)?.staffId).toBe(
      3
    );
  });

  it("calculates draft payroll from schedules and locks paid records", async () => {
    const admin = test.caller("admin", 1);
    const generated = await admin.workforce.generatePayroll({
      month: "2026-07",
    });
    expect(generated).toMatchObject({ generated: 1, skippedPaid: 0 });

    const [draft] = await admin.workforce.payrollList({ month: "2026-07" });
    expect(draft).toMatchObject({
      staffId: 3,
      workDays: 2,
      baseAmount: 1000,
      netAmount: 1000,
      status: "draft",
    });

    const updated = await admin.workforce.updatePayroll({
      id: draft.id,
      overtimeHours: 3,
      bonus: 100,
      deduction: 50,
      note: "โบนัสตรงเวลา",
    });
    expect(updated).toMatchObject({ overtimeAmount: 240, netAmount: 1290 });

    await admin.workforce.setPayrollStatus({ id: draft.id, status: "paid" });
    const ownPayroll = await test.caller("cashier", 3).workforce.myPayroll({
      month: "2026-07",
    });
    expect(ownPayroll).toMatchObject({ status: "paid", netAmount: 1290 });
    expect(ownPayroll?.paidAt).toBeInstanceOf(Date);

    await expect(
      admin.workforce.updatePayroll({
        id: draft.id,
        overtimeHours: 4,
        bonus: 0,
        deduction: 0,
      })
    ).rejects.toThrow("จ่ายแล้ว");
    await expect(
      test.caller("manager", 2).workforce.payrollList({ month: "2026-07" })
    ).rejects.toThrow();

    const [stored] = await test.db
      .select()
      .from(payrollRecords)
      .where(eq(payrollRecords.id, draft.id));
    expect(stored.netAmount).toBe(1290);
  });
});

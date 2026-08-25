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
    const third = await test.caller("admin", 1).workforce.createSchedule({
      workDate: "2026-07-06",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "completed",
      cashAdvance: 200,
    });
    await test.caller("admin", 1).workforce.updateSchedule({
      id: third.id,
      workDate: "2026-07-06",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "completed",
      cashAdvance: 250,
    });

    const ownBefore = await test.caller("cashier", 3).workforce.scheduleList({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    expect(ownBefore).toHaveLength(2);
    expect(ownBefore.every(schedule => schedule.staffId === 3)).toBe(true);
    expect(
      ownBefore.find(schedule => schedule.workDate === "2026-07-06")
        ?.cashAdvance
    ).toBe(250);

    const manager = test.caller("manager", 2);
    const branchSchedules = await manager.workforce.scheduleList({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    expect(branchSchedules).toHaveLength(3);
    await manager.workforce.updateCashAdvance({
      id: third.id,
      cashAdvance: 275,
    });
    await expect(
      test.caller("cashier", 3).workforce.updateCashAdvance({
        id: third.id,
        cashAdvance: 300,
      })
    ).rejects.toThrow("ผู้ดูแลระบบหรือผู้จัดการสาขา");
    const ownAfterAdvanceEdit = await test
      .caller("cashier", 3)
      .workforce.scheduleList({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      });
    expect(
      ownAfterAdvanceEdit.find(schedule => schedule.id === third.id)
        ?.cashAdvance
    ).toBe(275);

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
    await admin.workforce.upsertEmployeeProfile({
      staffId: 2,
      position: "ผู้จัดการสาขา",
      salaryType: "monthly",
      baseRate: 30_000,
      overtimeRate: 100,
    });
    const templates = await admin.workforce.listTemplates();
    const morning = templates.find(template => template.name === "กะเช้า")!;
    const afternoon = templates.find(template => template.name === "กะบ่าย")!;
    await Promise.all([
      admin.workforce.createSchedule({
        workDate: "2026-07-07",
        shiftTemplateId: morning.id,
        staffId: 2,
        status: "absent",
      }),
      admin.workforce.createSchedule({
        workDate: "2026-07-07",
        shiftTemplateId: afternoon.id,
        staffId: 2,
        status: "absent",
      }),
      admin.workforce.createSchedule({
        workDate: "2026-07-08",
        shiftTemplateId: morning.id,
        staffId: 2,
        status: "leave",
      }),
      admin.workforce.createSchedule({
        workDate: "2026-07-07",
        shiftTemplateId: morning.id,
        staffId: 3,
        status: "absent",
      }),
      admin.workforce.createSchedule({
        workDate: "2026-07-09",
        shiftTemplateId: morning.id,
        staffId: 2,
        status: "scheduled",
        cashAdvance: 300,
      }),
    ]);
    const generated = await admin.workforce.generatePayroll({
      month: "2026-07",
    });
    expect(generated).toMatchObject({ generated: 2, skippedPaid: 0 });

    const payroll = await admin.workforce.payrollList({ month: "2026-07" });
    const draft = payroll.find(row => row.staffId === 3)!;
    expect(draft).toMatchObject({
      staffId: 3,
      workDays: 2,
      absenceDays: 1,
      absenceDeduction: 0,
      advanceDeduction: 275,
      baseAmount: 1000,
      netAmount: 725,
      status: "draft",
    });
    const advanceSchedule = await test.db.query.workSchedules.findFirst({
      where: and(
        eq(workSchedules.staffId, 3),
        eq(workSchedules.workDate, "2026-07-06")
      ),
    });
    const syncedAdvance = await test
      .caller("manager", 2)
      .workforce.updateCashAdvance({
        id: advanceSchedule!.id,
        cashAdvance: 325,
      });
    expect(syncedAdvance).toMatchObject({
      advanceDeduction: 325,
      payrollUpdated: true,
    });
    const payrollAfterAdvanceEdit = await admin.workforce.payrollList({
      month: "2026-07",
    });
    expect(
      payrollAfterAdvanceEdit.find(row => row.staffId === 3)
    ).toMatchObject({
      advanceDeduction: 325,
      netAmount: 675,
    });
    const realtimeSchedule = await admin.workforce.createSchedule({
      workDate: "2026-07-10",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "scheduled",
      cashAdvance: 125,
    });
    expect(realtimeSchedule).toMatchObject({
      payrollUpdated: true,
      advanceDeduction: 450,
    });
    expect(
      (await admin.workforce.payrollList({ month: "2026-07" })).find(
        row => row.staffId === 3,
      ),
    ).toMatchObject({
      workDays: 3,
      advanceDeduction: 450,
      baseAmount: 1500,
      netAmount: 1050,
    });
    const updatedRealtimeSchedule = await admin.workforce.updateSchedule({
      id: realtimeSchedule.id,
      workDate: "2026-07-10",
      shiftTemplateId: morning.id,
      staffId: 3,
      status: "scheduled",
      cashAdvance: 150,
    });
    expect(updatedRealtimeSchedule).toMatchObject({ payrollUpdated: true });
    expect(
      (await admin.workforce.payrollList({ month: "2026-07" })).find(
        row => row.staffId === 3,
      ),
    ).toMatchObject({
      advanceDeduction: 475,
      netAmount: 1025,
    });
    const deletedRealtimeSchedule = await admin.workforce.deleteSchedule({
      id: realtimeSchedule.id,
    });
    expect(deletedRealtimeSchedule).toMatchObject({ payrollUpdated: true });
    expect(
      (await admin.workforce.payrollList({ month: "2026-07" })).find(
        row => row.staffId === 3,
      ),
    ).toMatchObject({
      workDays: 2,
      advanceDeduction: 325,
      baseAmount: 1000,
      netAmount: 675,
    });
    const monthlyDraft = payroll.find(row => row.staffId === 2)!;
    expect(monthlyDraft).toMatchObject({
      workDays: 2,
      absenceDays: 1,
      absenceDeduction: 1000,
      advanceDeduction: 300,
      baseAmount: 30_000,
      netAmount: 28_700,
      status: "draft",
    });
    await expect(
      admin.workforce.updatePayroll({
        id: monthlyDraft.id,
        overtimeHours: 0,
        bonus: 0,
        deduction: 500,
      })
    ).resolves.toMatchObject({ netAmount: 28_200 });

    const updated = await admin.workforce.updatePayroll({
      id: draft.id,
      overtimeHours: 3,
      bonus: 100,
      deduction: 50,
      note: "โบนัสตรงเวลา",
    });
    expect(updated).toMatchObject({ overtimeAmount: 240, netAmount: 965 });

    await admin.workforce.setPayrollStatus({ id: draft.id, status: "paid" });
    const ownPayroll = await test.caller("cashier", 3).workforce.myPayroll({
      month: "2026-07",
    });
    expect(ownPayroll).toMatchObject({
      status: "paid",
      advanceDeduction: 325,
      netAmount: 965,
    });
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
    expect(stored.netAmount).toBe(965);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  branches,
  shifts,
  staffUsers,
  workLeaveRequests,
  workSchedules,
} from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { setupTestDb, type TestDb } from "../test/testDb";

describe("workforce leave", () => {
  let test: TestDb;
  const year = 2027;
  const request = {
    type: "vacation" as const,
    startOn: "2027-03-20",
    endOn: "2027-03-21",
    note: "นัดหมายส่วนตัว",
  };

  beforeAll(async () => {
    test = await setupTestDb();
  });

  afterAll(() => test.cleanup());

  it("validates dates and serializes overlapping requests without duplicating retries", async () => {
    const employee = test.caller().workforce.leave;
    await expect(
      employee.submit({ ...request, startOn: "2027-02-30" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      employee.submit({ ...request, startOn: "2026-12-31" })
    ).rejects.toThrow("แยกตามปีปฏิทิน");
    const same = await Promise.all([
      employee.submit(request),
      employee.submit(request),
    ]);
    expect(same[0]).toEqual(same[1]);
    await expect(
      employee.submit({ ...request, type: "personal" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      test.anonymousCaller().workforce.leave.list({ year })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      employee.list({ year, scope: "branch" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      employee.review({ ...same[0], decision: "approved", days: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.caller("manager").workforce.leave.cancelMine(same[0])
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await employee.cancelMine(same[0]);
    const history = await employee.list({ year });
    expect(history.requests).toHaveLength(1);
    expect(history.requests[0]).toMatchObject({
      ...request,
      status: "cancelled",
    });
  });

  it("approves in branch, counts two shifts as one planned day and protects schedule assignments", async () => {
    const employee = test.caller().workforce;
    const manager = test.caller("manager").workforce;
    const admin = test.caller("admin").workforce;
    const [morning, afternoon, night] = await admin.listTemplates();
    const planned = { workDate: request.startOn, staffId: 3 };
    const first = await admin.createSchedule({
      ...planned,
      shiftTemplateId: morning!.id,
    });
    await admin.createSchedule({ ...planned, shiftTemplateId: afternoon!.id });
    const relief = await admin.createSchedule({
      workDate: request.endOn,
      shiftTemplateId: night!.id,
      staffId: 2,
    });
    await admin.leave.setQuota({ staffId: 3, year, type: "vacation", days: 3 });
    const submitted = await employee.leave.submit(request);
    const own = await manager.leave.list({ year });
    expect(own.requests).toEqual([]);
    const team = await manager.leave.list({ year, scope: "branch" });
    expect(team.requests.find(row => row.id === submitted.id)).toMatchObject({
      plannedDays: 1,
    });
    const [other] = await test.db
      .insert(branches)
      .values({ code: "LEAVE-OTHER", name: "สาขาอื่น" })
      .returning();
    await expect(
      test
        .caller("admin", 1, other!.id)
        .workforce.leave.review({ ...submitted, decision: "approved", days: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      manager.leave.review({ ...submitted, decision: "approved", days: 3 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await manager.leave.review({ ...submitted, decision: "approved", days: 1 });

    const history = await employee.leave.list({ year });
    expect(history.quotas).toContainEqual(
      expect.objectContaining({ type: "vacation", days: 3 })
    );
    expect(history.requests.find(row => row.id === submitted.id)).toMatchObject(
      {
        status: "approved",
        chargedDays: 1,
        reviewedBy: 2,
      }
    );
    const range = { startDate: request.startOn, endDate: request.endOn };
    expect(await employee.myScheduleList(range)).toEqual([
      expect.objectContaining({ approvedLeave: true, status: "scheduled" }),
      expect.objectContaining({ approvedLeave: true, status: "scheduled" }),
    ]);
    expect(
      (
        await test.db.query.workSchedules.findFirst({
          where: eq(workSchedules.id, first.id),
        })
      )?.status
    ).toBe("scheduled");
    await expect(
      admin.createSchedule({
        workDate: request.endOn,
        shiftTemplateId: afternoon!.id,
        staffId: 3,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      admin.updateSchedule({
        id: relief.id,
        workDate: request.endOn,
        shiftTemplateId: night!.id,
        staffId: 3,
        status: "scheduled",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      admin.swapSchedules({ firstId: first.id, secondId: relief.id })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await admin.updateSchedule({
      id: first.id,
      workDate: request.startOn,
      shiftTemplateId: morning!.id,
      staffId: 2,
      status: "scheduled",
    });
    expect(await admin.scheduleList(range)).toContainEqual(
      expect.objectContaining({
        id: first.id,
        staffId: 2,
        approvedLeave: false,
      })
    );

    await manager.leave.review({
      ...submitted,
      decision: "cancelled",
      note: "พนักงานขอยกเลิกวันลา",
    });
    expect(await employee.myScheduleList(range)).toEqual([
      expect.objectContaining({ approvedLeave: false }),
    ]);
    expect(
      (await employee.leave.list({ year })).requests.find(
        row => row.id === submitted.id
      )?.status
    ).toBe("cancelled");
  });

  it("records rejection and requires an explicit reason when exceeding a configured allowance", async () => {
    const manager = test.caller("manager").workforce.leave;
    const employee = test.caller().workforce.leave;
    const days = { startOn: "2027-04-04", endOn: "2027-04-04" };
    await test
      .caller("admin")
      .workforce.leave.setQuota({ staffId: 3, year, type: "sick", days: 0 });
    const sick = await employee.submit({ ...days, type: "sick" });
    await expect(
      manager.review({ ...sick, decision: "approved", days: 1 })
    ).rejects.toThrow("ระบุเหตุผลประกอบการอนุมัติ");
    const race = await Promise.allSettled([
      manager.review({
        ...sick,
        decision: "approved",
        days: 1,
        note: "ตรวจสอบแล้ว อนุมัติตามกรณี",
      }),
      manager.review({
        ...sick,
        decision: "approved",
        days: 1,
        note: "ตรวจสอบแล้ว อนุมัติตามกรณี",
      }),
    ]);
    expect(race.filter(result => result.status === "fulfilled")).toHaveLength(
      1
    );
    const self = await manager.submit({ ...days, type: "personal" });
    await expect(
      manager.review({ ...self, decision: "approved", days: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await test
      .caller("admin")
      .workforce.leave.review({
        ...self,
        decision: "rejected",
        note: "กรุณาตรวจวันที่อีกครั้ง",
      });
    expect((await manager.list({ year })).requests).toContainEqual(
      expect.objectContaining({
        id: self.id,
        status: "rejected",
        reviewNote: "กรุณาตรวจวันที่อีกครั้ง",
      })
    );
  });

  it("lets an off-shift employee use only their own leave functions with the workforce permission", async () => {
    const [shift] = await test.db
      .insert(shifts)
      .values({
        branchId: 1,
        staffId: 2,
        staffName: "ผู้จัดการ",
        status: "open",
      })
      .returning({ id: shifts.id });
    const employee = test.caller();
    const today = bangkokDateKey(new Date());
    const todayYear = Number(today.slice(0, 4));
    try {
      await expect(employee.auth.systemAccess()).resolves.toMatchObject({
        allowed: false,
      });
      await expect(employee.catalog.listProducts()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const submitted = await employee.workforce.leave.submit({
        type: "personal",
        startOn: today,
        endOn: today,
      });
      expect(
        (await employee.workforce.leave.list({ year: todayYear })).requests
      ).toContainEqual(
        expect.objectContaining({ id: submitted.id, status: "pending" })
      );
      await employee.workforce.leave.cancelMine(submitted);

      const admin = test.caller("admin").workforce;
      const [template] = await admin.listTemplates();
      await admin.createSchedule({
        staffId: 3,
        workDate: today,
        shiftTemplateId: template!.id,
      });
      await expect(employee.auth.systemAccess()).resolves.toMatchObject({
        allowed: true,
      });
      const approved = await employee.workforce.leave.submit({
        type: "personal",
        startOn: today,
        endOn: today,
      });
      await test
        .caller("manager")
        .workforce.leave.review({ ...approved, decision: "approved", days: 1 });
      await expect(employee.auth.systemAccess()).resolves.toMatchObject({
        allowed: false,
      });

      await test.db
        .update(staffUsers)
        .set({ menuPermissions: ["pos"] })
        .where(eq(staffUsers.id, 3));
      await expect(
        employee.workforce.leave.list({ year: todayYear })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        employee.workforce.leave.submit({
          type: "sick",
          startOn: today,
          endOn: today,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await test.db
        .update(staffUsers)
        .set({ menuPermissions: null })
        .where(eq(staffUsers.id, 3));
      await test.db.delete(shifts).where(eq(shifts.id, shift!.id));
      await test.db
        .delete(workLeaveRequests)
        .where(eq(workLeaveRequests.startOn, today));
    }
  });
});

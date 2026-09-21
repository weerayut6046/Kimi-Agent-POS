import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  attendanceEvents,
  attendanceSessions,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

function bangkokToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("attendance router", () => {
  let test: TestDb;
  let scheduleId: number;

  beforeAll(async () => {
    process.env.APP_SECRET = "attendance-router-test-secret-at-least-32-bytes";
    test = await setupTestDb();
    const [template] = await test.db
      .insert(workShiftTemplates)
      .values({
        branchId: 1,
        name: "กะทดสอบลงเวลา",
        startTime: "00:00",
        endTime: "00:00",
        breakMinutes: 60,
      })
      .returning();
    const [schedule] = await test.db
      .insert(workSchedules)
      .values({
        branchId: 1,
        workDate: bangkokToday(),
        shiftTemplateId: template!.id,
        staffId: 3,
        status: "scheduled",
        note: "ATTENDANCE-TEST",
      })
      .returning();
    scheduleId = schedule!.id;
  });

  afterAll(() => test.cleanup());

  it("requires a manager to create a short-lived branch QR", async () => {
    await expect(
      test.caller("cashier", 3).attendance.issueQrChallenge()
    ).rejects.toThrow("ผู้จัดการ");

    const challenge = await test
      .caller("manager", 2)
      .attendance.issueQrChallenge();
    expect(challenge.branchId).toBe(1);
    expect(challenge.token).toMatch(/^PUMPATT1\./);
    expect(challenge.expiresAt).toBeInstanceOf(Date);
  });

  it("clocks in once, links the schedule, and completes it on clock out", async () => {
    const manager = test.caller("manager", 2);
    const cashier = test.caller("cashier", 3);
    const firstQr = await manager.attendance.issueQrChallenge();

    const clockIn = await cashier.attendance.redeemQr({
      token: firstQr.token,
      action: "clock_in",
    });
    expect(clockIn).toMatchObject({
      ok: true,
      duplicate: false,
      action: "clock_in",
      session: {
        scheduleId,
        staffId: 3,
        status: "open",
        reviewStatus: "not_required",
      },
    });

    const duplicate = await cashier.attendance.redeemQr({
      token: firstQr.token,
      action: "clock_in",
    });
    expect(duplicate).toMatchObject({
      ok: true,
      duplicate: true,
      action: "clock_in",
      session: { id: clockIn.session.id },
    });

    const openStatus = await cashier.attendance.myStatus();
    expect(openStatus.nextAction).toBe("clock_out");
    expect(openStatus.openSession?.id).toBe(clockIn.session.id);

    const secondQr = await manager.attendance.issueQrChallenge();
    const clockOut = await cashier.attendance.redeemQr({
      token: secondQr.token,
      action: "clock_out",
    });
    expect(clockOut).toMatchObject({
      ok: true,
      duplicate: false,
      action: "clock_out",
      session: { id: clockIn.session.id, status: "completed" },
    });
    expect(clockOut.session.clockOutAt).toBeInstanceOf(Date);

    const schedule = await test.db.query.workSchedules.findFirst({
      where: eq(workSchedules.id, scheduleId),
    });
    expect(schedule?.status).toBe("completed");
    expect(
      await test.db.query.attendanceEvents.findMany({
        where: eq(attendanceEvents.sessionId, clockIn.session.id),
      })
    ).toHaveLength(2);

    const rows = await manager.attendance.branchList({
      workDate: bangkokToday(),
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: clockIn.session.id,
          staffId: 3,
          status: "completed",
          shiftName: "กะทดสอบลงเวลา",
        }),
      ])
    );
  });

  it("rejects another branch and marks attendance without a schedule for review", async () => {
    const { issueAttendanceQrToken } = await import("../lib/attendanceToken");
    const wrongBranch = issueAttendanceQrToken(2);
    await expect(
      test.caller("manager", 2).attendance.redeemQr({
        token: wrongBranch.token,
        action: "clock_in",
      })
    ).rejects.toThrow("สาขาอื่น");

    await test.db
      .delete(workSchedules)
      .where(
        and(
          eq(workSchedules.staffId, 2),
          eq(workSchedules.workDate, bangkokToday())
        )
      );
    const manager = test.caller("manager", 2);
    const qr = await manager.attendance.issueQrChallenge();
    const unscheduled = await manager.attendance.redeemQr({
      token: qr.token,
      action: "clock_in",
    });
    expect(unscheduled.session).toMatchObject({
      staffId: 2,
      scheduleId: null,
      reviewStatus: "pending",
      status: "open",
    });

    await test.db
      .delete(attendanceEvents)
      .where(eq(attendanceEvents.sessionId, unscheduled.session.id));
    await test.db
      .delete(attendanceSessions)
      .where(eq(attendanceSessions.id, unscheduled.session.id));
  });
});

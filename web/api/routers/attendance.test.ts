import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  attendanceEvents,
  attendanceSessions,
  employeeFaceProfiles,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

function bangkokToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function embedding(offset = 0): number[] {
  return Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.17 + offset) * 0.12
  );
}

const quality = {
  faceScore: 0.9,
  real: 0.91,
  live: 0.92,
  faceSize: 240,
  actionSatisfied: true as const,
};

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

  it("requires enrollment and stores only an encrypted face template", async () => {
    const manager = test.caller("manager", 2);
    const cashier = test.caller("cashier", 3);
    const qr = await manager.attendance.issueQrChallenge();
    await expect(
      cashier.attendance.beginFaceVerification({ qrToken: qr.token })
    ).rejects.toThrow("ยังไม่ได้ลงทะเบียนใบหน้า");

    await expect(
      cashier.attendance.enrollFace({
        staffId: 3,
        embeddings: [embedding(), embedding(0.01), embedding(-0.01)],
        consentConfirmed: true,
      })
    ).rejects.toThrow("ผู้จัดการ");

    await manager.attendance.enrollFace({
      staffId: 3,
      embeddings: [embedding(), embedding(0.01), embedding(-0.01)],
      consentConfirmed: true,
    });
    const stored = await test.db.query.employeeFaceProfiles.findFirst({
      where: eq(employeeFaceProfiles.staffId, 3),
    });
    expect(stored).toMatchObject({
      staffId: 3,
      embeddingCount: 3,
      embeddingDimensions: 128,
      model: "human-faceres-v1",
    });
    expect(stored?.templateEncrypted).toMatch(/^v1\./);
    expect(stored?.templateEncrypted).not.toContain(
      JSON.stringify(embedding())
    );
  });

  it("clocks in through QR plus face, links the schedule, and completes it", async () => {
    const manager = test.caller("manager", 2);
    const cashier = test.caller("cashier", 3);
    const firstQr = await manager.attendance.issueQrChallenge();
    const firstFace = await cashier.attendance.beginFaceVerification({
      qrToken: firstQr.token,
    });
    expect(firstFace.token).toMatch(/^PUMPFACE1\./);
    expect(["blink", "turn_left", "turn_right"]).toContain(
      firstFace.livenessAction
    );

    const clockIn = await cashier.attendance.completeFaceVerification({
      challengeToken: firstFace.token,
      embedding: embedding(),
      quality,
    });
    expect(clockIn).toMatchObject({
      ok: true,
      duplicate: false,
      action: "clock_in",
      similarity: 1,
      session: {
        scheduleId,
        staffId: 3,
        status: "open",
        reviewStatus: "not_required",
        clockInMethod: "face",
      },
    });

    const duplicate = await cashier.attendance.completeFaceVerification({
      challengeToken: firstFace.token,
      embedding: embedding(),
      quality,
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
    expect(openStatus.faceProfile.enrolled).toBe(true);

    const secondQr = await manager.attendance.issueQrChallenge();
    const secondFace = await cashier.attendance.beginFaceVerification({
      qrToken: secondQr.token,
    });
    const clockOut = await cashier.attendance.completeFaceVerification({
      challengeToken: secondFace.token,
      embedding: embedding(0.01),
      quality,
    });
    expect(clockOut).toMatchObject({
      ok: true,
      duplicate: false,
      action: "clock_out",
      session: {
        id: clockIn.session.id,
        status: "completed",
        clockOutMethod: "face",
      },
    });
    expect(clockOut.session.clockOutAt).toBeInstanceOf(Date);

    const schedule = await test.db.query.workSchedules.findFirst({
      where: eq(workSchedules.id, scheduleId),
    });
    expect(schedule?.status).toBe("completed");
    const events = await test.db.query.attendanceEvents.findMany({
      where: eq(attendanceEvents.sessionId, clockIn.session.id),
    });
    expect(events).toHaveLength(2);
    expect(events.every(event => event.method === "face")).toBe(true);

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
      test.caller("manager", 2).attendance.beginFaceVerification({
        qrToken: wrongBranch.token,
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
    await manager.attendance.enrollFace({
      staffId: 2,
      embeddings: [embedding(1), embedding(1.01), embedding(0.99)],
      consentConfirmed: true,
    });
    const qr = await manager.attendance.issueQrChallenge();
    const face = await manager.attendance.beginFaceVerification({
      qrToken: qr.token,
    });
    const unscheduled = await manager.attendance.completeFaceVerification({
      challengeToken: face.token,
      embedding: embedding(1),
      quality,
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

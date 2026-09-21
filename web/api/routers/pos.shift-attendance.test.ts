import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { attendanceSessions } from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

const openingReadings = async () =>
  (await test.db.query.nozzles.findMany()).map(nozzle => ({
    nozzleId: nozzle.id,
    openMeter: nozzle.currentMeter,
    openMoney: nozzle.currentMoney,
  }));

describe("openShift attendance gate", () => {
  it("requires today's active face clock-in and trusts the signed staff identity", async () => {
    const input = {
      staffId: 1,
      staffName: "ชื่อปลอมจาก client",
      readings: await openingReadings(),
    };

    await expect(test.caller().pos.openShift(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "กรุณาสแกน QR และยืนยันใบหน้าเข้างานของวันนี้ก่อนเปิดกะ",
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [attendance] = await test.db
      .insert(attendanceSessions)
      .values({
        branchId: 1,
        staffId: 3,
        workDate: bangkokDateKey(yesterday),
        clockInAt: yesterday,
        clockInMethod: "face",
        status: "open",
      })
      .returning();

    await expect(test.caller().pos.openShift(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    await test.db
      .update(attendanceSessions)
      .set({
        workDate: bangkokDateKey(new Date()),
        clockInAt: new Date(),
        clockInMethod: "manual",
      })
      .where(eq(attendanceSessions.id, attendance!.id));

    await expect(test.caller().pos.openShift(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    await test.db
      .update(attendanceSessions)
      .set({ clockInMethod: "face" })
      .where(eq(attendanceSessions.id, attendance!.id));

    const result = await test.caller().pos.openShift(input);
    expect(result.shift.staffId).toBe(3);
    expect(result.shift.staffName).toBe("สมชาย (พนักงาน)");
  });
});

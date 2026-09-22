import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;
beforeAll(async () => {
  test = await setupTestDb();
});
afterAll(() => test.cleanup());

describe("openShift after attendance removal", () => {
  it("opens a shift without a face attendance record and uses signed staff identity", async () => {
    const nozzles = await test.db.query.nozzles.findMany();
    const result = await test.caller().pos.openShift({
      staffId: 1,
      staffName: "Untrusted client name",
      readings: nozzles.map(nozzle => ({
        nozzleId: nozzle.id,
        openMeter: nozzle.currentMeter,
        openMoney: nozzle.currentMoney,
      })),
    });
    expect(result.shift.staffId).toBe(3);
    expect(result.shift.staffName).not.toBe("Untrusted client name");
    expect(await test.db.query.attendanceSessions.findMany()).toHaveLength(0);
  });
});

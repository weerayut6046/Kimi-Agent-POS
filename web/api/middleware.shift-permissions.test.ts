import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "./test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db
    .update(staffUsers)
    .set({
      accessGroupId: null,
      menuPermissions: ["pos", "sales", "dashboard"],
    })
    .where(eq(staffUsers.id, 3));
});

afterAll(() => t.cleanup());

const shiftOperations = [
  [
    "openShift",
    (caller: ReturnType<TestDb["caller"]>) =>
      caller.pos.openShift({
        staffName: "ทดสอบสิทธิ์",
        readings: [{ nozzleId: 1, openMeter: 0, openMoney: 0 }],
      }),
  ],
  [
    "closeShift",
    (caller: ReturnType<TestDb["caller"]>) =>
      caller.pos.closeShift({
        shiftId: 1,
        readings: [{ nozzleId: 1, closeMeter: 0, closeMoney: 0 }],
      }),
  ],
  [
    "shiftHistory",
    (caller: ReturnType<TestDb["caller"]>) => caller.pos.shiftHistory(),
  ],
  [
    "shiftDetail",
    (caller: ReturnType<TestDb["caller"]>) => caller.pos.shiftDetail({ id: 1 }),
  ],
  [
    "shiftMeterVerify",
    (caller: ReturnType<TestDb["caller"]>) =>
      caller.pos.shiftMeterVerify({
        shiftId: 1,
        images: [{ mimeType: "image/jpeg", contentBase64: "/9j/4AAQ" }],
      }),
  ],
] as const;

describe("shift API menu permissions", () => {
  it.each(shiftOperations)(
    "requires a signed staff session for %s",
    async (_name, operation) => {
      await expect(operation(t.anonymousCaller())).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }
  );

  it.each(shiftOperations)(
    "rejects %s when a cashier has other POS permissions without shifts",
    async (_name, operation) => {
      await expect(operation(t.caller("cashier", 3))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "สิทธิ์ไม่เพียงพอสำหรับเมนูที่ร้องขอ",
      });
      expect(await t.db.query.shifts.findMany()).toHaveLength(0);
    }
  );

  it("shares current shift status with signed staff while retaining authentication", async () => {
    await expect(t.caller("cashier", 3).pos.currentShift()).resolves.toBeNull();
    await expect(t.anonymousCaller().pos.currentShift()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows explicit shift grants to open, close and read a shift", async () => {
    await t.db
      .update(staffUsers)
      .set({ menuPermissions: ["shifts"] })
      .where(eq(staffUsers.id, 3));
    const nozzles = await t.db.query.nozzles.findMany();
    const { shiftId } = await t.caller("cashier", 3).pos.openShift({
      staffName: "ทดสอบสิทธิ์",
      readings: nozzles.map(nozzle => ({
        nozzleId: nozzle.id,
        openMeter: nozzle.currentMeter,
        openMoney: nozzle.currentMoney,
      })),
    });

    await expect(
      t.caller("cashier", 3).pos.shiftDetail({ id: shiftId })
    ).resolves.toMatchObject({ id: shiftId, status: "open" });
    await t.caller("cashier", 3).pos.closeShift({
      shiftId,
      readings: nozzles.map(nozzle => ({
        nozzleId: nozzle.id,
        closeMeter: nozzle.currentMeter,
        closeMoney: nozzle.currentMoney,
      })),
    });
    await expect(t.caller("cashier", 3).pos.shiftHistory()).resolves.toEqual([
      expect.objectContaining({ id: shiftId, status: "closed" }),
    ]);
  });

  it("retains administrator access even when stored permissions are empty", async () => {
    await t.db
      .update(staffUsers)
      .set({ accessGroupId: null, menuPermissions: [] })
      .where(eq(staffUsers.id, 1));

    await expect(t.caller("admin", 1).pos.shiftHistory()).resolves.toEqual([
      expect.objectContaining({ status: "closed" }),
    ]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  auditLogs,
  debtPayments,
  expenses,
  sales,
  shiftReadings,
  shifts,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;
const r2 = (value: number) => Math.round(value * 100) / 100;
const r3 = (value: number) => Math.round(value * 1000) / 1000;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

const historyInput = {
  staffId: null,
  staffName: "พนักงานย้อนหลัง",
  openedAt: new Date("2026-07-10T06:00:00+07:00"),
  closedAt: new Date("2026-07-10T14:00:00+07:00"),
  totalLiters: 100.125,
  totalAmount: 4000.555,
  totalMoneyMeter: 4001.557,
  posAmount: 3900,
  openingFloat: 1000,
  countedCash: 4950.555,
  transferAmount: 500,
  expectedCash: 4900,
  note: "นำเข้าประวัติเก่า",
};

describe("admin จัดการประวัติการตัดกะ", () => {
  let shiftId: number;

  it("จำกัดการค้นหาและเพิ่มไว้เฉพาะ admin", async () => {
    await expect(
      t.caller("manager").pos.searchShiftHistory({ limit: 50 })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    await expect(
      t.caller("cashier").pos.createShiftHistory(historyInput)
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    const created = await t
      .caller("admin", 1)
      .pos.createShiftHistory(historyInput);
    shiftId = created.id;

    const stored = await t.db.query.shifts.findFirst({
      where: eq(shifts.id, shiftId),
    });
    expect(stored).toMatchObject({
      staffName: "พนักงานย้อนหลัง",
      status: "closed",
      totalLiters: 100.125,
      totalAmount: 4000.56,
      totalMoneyMeter: 4001.56,
    });
  });

  it("ค้นหาด้วยชื่อ หมายเลขกะ สถานะ และช่วงวันที่", async () => {
    const byName = await t.caller("admin").pos.searchShiftHistory({
      q: "ย้อนหลัง",
      status: "closed",
      from: "2026-07-10",
      to: "2026-07-10",
      limit: 50,
    });
    expect(byName.map(row => row.id)).toContain(shiftId);

    const byId = await t.caller("admin").pos.searchShiftHistory({
      q: String(shiftId),
      limit: 50,
    });
    expect(byId.map(row => row.id)).toContain(shiftId);
  });

  it("เพิ่มประวัติพร้อมเลขเปิด-ปิดรายหัวจ่ายและคำนวณยอดรวม", async () => {
    const nozzleRows = (await t.db.query.nozzles.findMany()).filter(
      nozzle => nozzle.active
    );
    expect(nozzleRows.length).toBeGreaterThan(0);
    const productRows = await t.db.query.products.findMany();
    const readings = nozzleRows.map((nozzle, index) => ({
      nozzleId: nozzle.id,
      openMeter: 1000 + index * 100,
      closeMeter: 1010.125 + index * 100,
      openMoney: 10_000 + index * 1000,
      closeMoney: 10_400 + index * 1000,
    }));
    let expectedLiters = 0;
    let expectedAmount = 0;
    for (const reading of readings) {
      const nozzle = nozzleRows.find(row => row.id === reading.nozzleId)!;
      const price =
        productRows.find(product => product.id === nozzle.productId)?.price ??
        0;
      const liters = r3(reading.closeMeter - reading.openMeter);
      expectedLiters = r3(expectedLiters + liters);
      expectedAmount = r2(expectedAmount + r2(liters * price));
    }

    const created = await t.caller("admin", 1).pos.createShiftHistory({
      ...historyInput,
      staffName: "ประวัติพร้อมมิเตอร์",
      totalLiters: 0,
      totalAmount: 0,
      totalMoneyMeter: 0,
      readings,
    });

    expect(created).toMatchObject({
      totalLiters: expectedLiters,
      totalAmount: expectedAmount,
      totalMoneyMeter: 400 * readings.length,
    });
    const stored = await t.db.query.shifts.findFirst({
      where: eq(shifts.id, created.id),
    });
    expect(stored).toMatchObject({
      totalLiters: expectedLiters,
      totalAmount: expectedAmount,
      totalMoneyMeter: 400 * readings.length,
    });
    const storedReadings = await t.db.query.shiftReadings.findMany({
      where: eq(shiftReadings.shiftId, created.id),
    });
    expect(storedReadings).toHaveLength(readings.length);
    expect(storedReadings[0]).toMatchObject({
      openMeter: readings[0]?.openMeter,
      closeMeter: readings[0]?.closeMeter,
      openMoney: readings[0]?.openMoney,
      closeMoney: readings[0]?.closeMoney,
    });

    await expect(
      t.caller("admin", 1).pos.createShiftHistory({
        ...historyInput,
        readings: readings.map((reading, index) =>
          index === 0
            ? { ...reading, closeMeter: reading.openMeter - 1 }
            : reading
        ),
      })
    ).rejects.toThrow("เลขลิตรปิดกะ");
  });

  it("admin แก้ไขข้อมูลสรุปของกะปิดแล้วได้", async () => {
    await t.caller("admin", 1).pos.updateShiftHistory({
      id: shiftId,
      ...historyInput,
      staffName: "พนักงานแก้ไขแล้ว",
      totalLiters: 120,
      countedCash: null,
      note: "แก้ข้อมูลแล้ว",
    });

    const stored = await t.db.query.shifts.findFirst({
      where: eq(shifts.id, shiftId),
    });
    expect(stored).toMatchObject({
      staffName: "พนักงานแก้ไขแล้ว",
      totalLiters: 120,
      countedCash: null,
      note: "แก้ข้อมูลแล้ว",
    });
  });

  it("แก้เลข P/L ปิดกะรายหัวจ่ายและคำนวณยอดรวมใหม่", async () => {
    const nozzle = (await t.db.query.nozzles.findMany())[0]!;
    const [{ id: meterShiftId }] = await t.db
      .insert(shifts)
      .values({
        staffName: "กะทดสอบมิเตอร์",
        openedAt: historyInput.openedAt,
        closedAt: historyInput.closedAt,
        status: "closed",
      })
      .returning({ id: shifts.id });
    await t.db.insert(shiftReadings).values({
      shiftId: meterShiftId,
      nozzleId: nozzle.id,
      openMeter: 100,
      closeMeter: 110,
      openMoney: 1000,
      closeMoney: 1400,
      pricePerLiter: 40,
    });

    const result = await t.caller("admin", 1).pos.updateShiftHistory({
      id: meterShiftId,
      ...historyInput,
      readings: [{ nozzleId: nozzle.id, closeMeter: 112.5, closeMoney: 1502 }],
    });
    expect(result).toMatchObject({
      totalLiters: 12.5,
      totalAmount: 500,
      totalMoneyMeter: 502,
    });

    const stored = await t.db.query.shifts.findFirst({
      where: eq(shifts.id, meterShiftId),
    });
    expect(stored).toMatchObject({
      totalLiters: 12.5,
      totalAmount: 500,
      totalMoneyMeter: 502,
    });
    const reading = await t.db.query.shiftReadings.findFirst({
      where: eq(shiftReadings.shiftId, meterShiftId),
    });
    expect(reading).toMatchObject({ closeMeter: 112.5, closeMoney: 1502 });

    await expect(
      t.caller("admin").pos.updateShiftHistory({
        id: meterShiftId,
        ...historyInput,
        readings: [{ nozzleId: nozzle.id, closeMeter: 99, closeMoney: 1502 }],
      })
    ).rejects.toThrow("เลขลิตรปิดกะ");
  });

  it("ไม่อนุญาตให้แก้ไขหรือลบกะที่กำลังเปิด", async () => {
    const [{ id: openId }] = await t.db
      .insert(shifts)
      .values({ staffName: "กะกำลังเปิด" })
      .returning({ id: shifts.id });

    await expect(
      t.caller("admin").pos.updateShiftHistory({
        id: openId,
        ...historyInput,
      })
    ).rejects.toThrow("กรุณาปิดกะก่อน");
    await expect(
      t.caller("admin").pos.deleteShiftHistory({ id: openId })
    ).rejects.toThrow("กรุณาปิดกะก่อน");
  });

  it("ลบประวัติได้โดยเก็บเอกสารการเงินและยกเลิกการผูกกะ", async () => {
    const customer = await t.caller("manager").customers.create({
      name: "ลูกค้าทดสอบประวัติกะ",
    });
    await t.db.insert(sales).values({
      receiptNo: "SHIFT-ADMIN-001",
      shiftId,
      subtotal: 100,
      total: 100,
    });
    await t.db.insert(expenses).values({
      title: "ค่าใช้จ่ายทดสอบ",
      amount: 20,
      shiftId,
    });
    await t.db.insert(debtPayments).values({
      paymentNo: "SHIFT-ADMIN-PAY-001",
      customerId: customer!.id,
      amount: 50,
      shiftId,
    });

    await expect(
      t.caller("manager").pos.deleteShiftHistory({ id: shiftId })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    await t.caller("admin", 1).pos.deleteShiftHistory({ id: shiftId });

    expect(
      await t.db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) })
    ).toBeUndefined();
    expect(
      await t.db.query.sales.findFirst({
        where: eq(sales.receiptNo, "SHIFT-ADMIN-001"),
      })
    ).toMatchObject({ shiftId: null });
    expect(
      await t.db.query.expenses.findFirst({
        where: eq(expenses.title, "ค่าใช้จ่ายทดสอบ"),
      })
    ).toMatchObject({ shiftId: null });
    expect(
      await t.db.query.debtPayments.findFirst({
        where: eq(debtPayments.paymentNo, "SHIFT-ADMIN-PAY-001"),
      })
    ).toMatchObject({ shiftId: null });

    const actions = (
      await t.db.query.auditLogs.findMany({
        where: eq(auditLogs.refId, shiftId),
      })
    ).map(row => row.action);
    expect(actions).toContain("create_shift_history");
    expect(actions).toContain("update_shift_history");
    expect(actions).toContain("delete_shift_history");
  });
});

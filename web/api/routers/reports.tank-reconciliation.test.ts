import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  fuelTanks,
  nozzles,
  products,
  shiftReadings,
  shifts,
  tankReadings,
  tankRefills,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสการคำนวณกระทบยอดถังบนฐานชั่วคราว (migrate + seed)
// ทุกเวลาผูกกับ +07:00 เพื่อให้ตรงกับ bangkokBoundary ของรายงานไม่ว่าเครื่องเทสต์จะโซนเวลาใด
let t: TestDb;

const T0 = new Date("2026-07-20T08:00:00+07:00");
const at = (hours: number, minutes = 0) =>
  new Date(T0.getTime() + hours * 3_600_000 + minutes * 60_000);

let gshTankId: number;
let db7TankId: number;

beforeAll(async () => {
  t = await setupTestDb();

  const gsh95 = await t.db.query.products.findFirst({
    where: eq(products.code, "GSH95"),
  });
  const db7 = await t.db.query.products.findFirst({
    where: eq(products.code, "DB7"),
  });
  const gshTank = await t.db.query.fuelTanks.findFirst({
    where: and(eq(fuelTanks.productId, gsh95!.id), eq(fuelTanks.branchId, 1)),
  });
  const db7Tank = await t.db.query.fuelTanks.findFirst({
    where: and(eq(fuelTanks.productId, db7!.id), eq(fuelTanks.branchId, 1)),
  });
  gshTankId = gshTank!.id;
  db7TankId = db7Tank!.id;
  const nozzleRows = await t.db.query.nozzles.findMany({
    where: eq(nozzles.branchId, 1),
  });
  const gshNozzle = nozzleRows.find(n => n.tankId === gshTankId)!;
  const db7Nozzle = nozzleRows.find(n => n.tankId === db7TankId)!;

  // R0: ค่าวัดเปิดช่วง 10,000 ลิตร
  await t.db.insert(tankReadings).values({
    branchId: 1,
    tankId: gshTankId,
    liters: 10000,
    measuredAt: T0,
    staffName: "ทดสอบ",
  });
  // รับเข้า 500 ลิตรในช่วง R0→R1
  await t.db.insert(tankRefills).values({
    branchId: 1,
    tankId: gshTankId,
    liters: 500,
    costPerLiter: 38,
    createdAt: at(0, 30),
  });
  // S1 ปิดแล้ว: GSH95 จ่าย 300 ลิตร, DB7 จ่าย 50 ลิตร (ต้องไม่ปนเข้าถัง GSH95)
  const [s1] = await t.db
    .insert(shifts)
    .values({
      branchId: 1,
      staffName: "ทดสอบ",
      openedAt: at(1),
      closedAt: at(2),
      status: "closed",
    })
    .returning();
  await t.db.insert(shiftReadings).values([
    {
      branchId: 1,
      shiftId: s1!.id,
      nozzleId: gshNozzle.id,
      openMeter: 1000,
      closeMeter: 1300,
    },
    {
      branchId: 1,
      shiftId: s1!.id,
      nozzleId: db7Nozzle.id,
      openMeter: 500,
      closeMeter: 550,
    },
  ]);
  // R1: expected = 10000 + 500 − 300 = 10200 → ผลต่าง 0
  await t.db.insert(tankReadings).values({
    branchId: 1,
    tankId: gshTankId,
    liters: 10200,
    measuredAt: at(3),
    staffName: "ทดสอบ",
  });
  // S2 ปิดแล้ว: GSH95 จ่ายอีก 200 ลิตรในช่วง R1→R2
  const [s2] = await t.db
    .insert(shifts)
    .values({
      branchId: 1,
      staffName: "ทดสอบ",
      openedAt: at(3, 10),
      closedAt: at(3, 30),
      status: "closed",
    })
    .returning();
  await t.db.insert(shiftReadings).values({
    branchId: 1,
    shiftId: s2!.id,
    nozzleId: gshNozzle.id,
    openMeter: 1300,
    closeMeter: 1500,
  });
  // S3 ยังเปิดอยู่: แม้มี closeMeter ค้างอยู่ก็ต้องไม่ถูกนับ
  const [s3] = await t.db
    .insert(shifts)
    .values({ branchId: 1, staffName: "ทดสอบ", openedAt: at(3, 40) })
    .returning();
  await t.db.insert(shiftReadings).values({
    branchId: 1,
    shiftId: s3!.id,
    nozzleId: gshNozzle.id,
    openMeter: 1500,
    closeMeter: 1600,
  });
  // R2: expected = 10200 − 200 = 10000 → ผลต่าง −20 (−10% ของยอดจ่าย) = ผิดปกติ
  await t.db.insert(tankReadings).values({
    branchId: 1,
    tankId: gshTankId,
    liters: 9980,
    measuredAt: at(4),
    staffName: "ทดสอบ",
  });
  // R3 วันถัดไป: ใช้ R2 เป็น baseline, ไม่มีเคลื่อนไหว → ผลต่าง +5, ไม่มียอดจ่าย = เฝ้าระวัง
  await t.db.insert(tankReadings).values({
    branchId: 1,
    tankId: gshTankId,
    liters: 9985,
    measuredAt: new Date("2026-07-21T08:00:00+07:00"),
    staffName: "ทดสอบ",
  });
});

afterAll(() => t.cleanup());

describe("reports.tankReconciliation", () => {
  it("คำนวณ expected/variance ต่อคู่ค่าวัดจากรับเข้าและมิเตอร์กะที่ปิดแล้ว", async () => {
    const res = await t.caller("manager").reports.tankReconciliation({
      from: "2026-07-20",
      to: "2026-07-20",
    });
    const entry = res.tanks.find(row => row.tank.id === gshTankId)!;
    expect(entry).toBeDefined();
    expect(entry.rows).toHaveLength(3);

    const [baseline, r1, r2] = entry.rows;
    expect(baseline!.isBaseline).toBe(true);
    expect(baseline!.varianceLiters).toBeNull();

    expect(r1!.refillsLiters).toBe(500);
    expect(r1!.meteredLiters).toBe(300); // S1 เท่านั้น — S3 ที่ยังเปิดอยู่ไม่ถูกนับ
    expect(r1!.expectedLiters).toBe(10200);
    expect(r1!.varianceLiters).toBe(0);
    expect(r1!.variancePct).toBe(0);
    expect(r1!.status).toBe("ok");

    expect(r2!.refillsLiters).toBe(0);
    expect(r2!.meteredLiters).toBe(200);
    expect(r2!.expectedLiters).toBe(10000);
    expect(r2!.varianceLiters).toBe(-20);
    expect(r2!.variancePct).toBe(-10);
    expect(r2!.status).toBe("critical");

    expect(entry.totals.refillsLiters).toBe(500);
    expect(entry.totals.meteredLiters).toBe(500);
    expect(entry.totals.varianceLiters).toBe(-20);
    expect(entry.totals.status).toBe("critical");

    // ส่วนต่างสะสมเทียบค่าวัดล่าสุดในช่วง (R2 = 9980) ชดเชยเคลื่อนไหวหลังวัดแล้ว
    const tankRow = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, gshTankId),
    });
    expect(entry.latestReading!.liters).toBe(9980);
    expect(entry.driftAtLatest).toBe(
      Math.round((tankRow!.currentLiters - 9980) * 1000) / 1000
    );

    // ถัง DB7 ไม่มีค่าวัด และยอดมิเตอร์ 50 ลิตรของ DB7 ต้องไม่รั่วเข้าถัง GSH95
    const db7Entry = res.tanks.find(row => row.tank.id === db7TankId)!;
    expect(db7Entry.rows).toHaveLength(0);
  });

  it("ใช้ค่าวัดก่อนช่วงเป็น baseline และไม่มียอดจ่ายให้เกณฑ์เป็นลิตร", async () => {
    const res = await t.caller("manager").reports.tankReconciliation({
      from: "2026-07-21",
      to: "2026-07-21",
    });
    const entry = res.tanks.find(row => row.tank.id === gshTankId)!;
    expect(entry.rows).toHaveLength(1);
    const row = entry.rows[0]!;
    expect(row.isBaseline).toBe(false);
    expect(row.expectedLiters).toBe(9980); // baseline คือ R2 ของวันก่อนหน้า
    expect(row.varianceLiters).toBe(5);
    expect(row.meteredLiters).toBe(0);
    expect(row.variancePct).toBeNull();
    expect(row.status).toBe("warn");
  });

  it("filter tankId, กัน cashier และแยกสาขา", async () => {
    const only = await t.caller("manager").reports.tankReconciliation({
      from: "2026-07-20",
      to: "2026-07-20",
      tankId: gshTankId,
    });
    expect(only.tanks).toHaveLength(1);
    expect(only.tanks[0]!.tank.id).toBe(gshTankId);

    await expect(
      t.caller("cashier").reports.tankReconciliation({
        from: "2026-07-20",
        to: "2026-07-20",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    const created = await t.caller("admin").auth.createBranch({
      code: "RECON-BR2",
      name: "สาขาทดสอบกระทบยอด",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    const otherBranch = await t
      .caller("admin", 1, created.branch.id)
      .reports.tankReconciliation({ from: "2026-07-20", to: "2026-07-20" });
    // สาขาใหม่มีถังที่ clone ไป แต่ไม่มีค่าวัด/เคลื่อนไหวของสาขาหลักรั่วเข้าไป
    expect(otherBranch.tanks.length).toBeGreaterThan(0);
    expect(otherBranch.tanks.some(row => row.tank.id === gshTankId)).toBe(
      false
    );
    for (const row of otherBranch.tanks) {
      expect(row.rows).toHaveLength(0);
      expect(row.latestReading).toBeNull();
    }
  });

  it("ปฏิเสธช่วงวันที่กลับด้าน", async () => {
    await expect(
      t.caller("manager").reports.tankReconciliation({
        from: "2026-07-21",
        to: "2026-07-20",
      })
    ).rejects.toThrow("วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
  });
});

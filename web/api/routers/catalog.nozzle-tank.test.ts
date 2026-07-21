import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fuelTanks, products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("การผูกหัวจ่ายกับถังน้ำมัน", () => {
  it("คืนรายการถังตามตำแหน่งหัวจ่ายเพื่อให้ตู้หน้าอยู่ก่อนตู้หลัง", async () => {
    const tanks = await t.caller().catalog.listTanks();
    const pumps = await t.caller().catalog.listPumps();
    const nozzles = pumps.flatMap(pump => pump.nozzles);
    const firstNozzleIds = tanks.map(tank =>
      Math.min(
        ...nozzles
          .filter(nozzle => nozzle.tankId === tank.id)
          .map(nozzle => nozzle.id)
      )
    );

    expect(firstNozzleIds).toEqual([...firstNozzleIds].sort((a, b) => a - b));
  });

  it("admin ลากสลับและบันทึกลำดับถังถาวรได้", async () => {
    const original = await t.caller().catalog.listTanks();
    const reversedIds = original.map(tank => tank.id).reverse();

    await expect(
      t.caller("cashier").catalog.reorderTanks({ tankIds: reversedIds })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    await t.caller("admin").catalog.reorderTanks({ tankIds: reversedIds });
    const reordered = await t.caller().catalog.listTanks();
    expect(reordered.map(tank => tank.id)).toEqual(reversedIds);

    await expect(
      t.caller("admin").catalog.reorderTanks({
        tankIds: [reversedIds[0]!, reversedIds[0]!],
      })
    ).rejects.toThrow("รายการซ้ำ");
  });

  it("seed ผูกทุกหัวจ่ายกับถังชนิดเดียวกัน", async () => {
    const pumps = await t.caller().catalog.listPumps();
    const nozzleRows = pumps.flatMap(pump => pump.nozzles);

    expect(nozzleRows).toHaveLength(4);
    for (const nozzle of nozzleRows) {
      expect(nozzle.tank).not.toBeNull();
      expect(nozzle.tank!.productId).toBe(nozzle.productId);
    }
  });

  it("เฉพาะ admin เปลี่ยนถังได้ และถังต้องตรงกับชนิดน้ำมัน", async () => {
    const productsRows = await t.db.query.products.findMany();
    const gsh95 = productsRows.find(product => product.code === "GSH95")!;
    const db7 = productsRows.find(product => product.code === "DB7")!;
    const nozzle = (await t.db.query.nozzles.findMany()).find(
      row => row.productId === gsh95.id
    )!;
    const db7Tank = (await t.db.query.fuelTanks.findMany()).find(
      tank => tank.productId === db7.id
    )!;

    await expect(
      t.caller("manager").catalog.updateNozzleMeter({
        id: nozzle.id,
        tankId: db7Tank.id,
      })
    ).rejects.toThrow("admin");

    await expect(
      t.caller("admin").catalog.updateNozzleMeter({
        id: nozzle.id,
        tankId: db7Tank.id,
      })
    ).rejects.toThrow("ถังน้ำมันต้องเป็นชนิดเดียวกับสินค้า");
  });

  it("เฉพาะ admin แก้ชนิดน้ำมันของถังที่ยังไม่ผูกหัวจ่ายได้", async () => {
    const productsRows = await t.db.query.products.findMany();
    const gsh91 = productsRows.find(product => product.code === "GSH91")!;
    const db7 = productsRows.find(product => product.code === "DB7")!;

    await t.caller("admin").catalog.createTank({
      productId: gsh91.id,
      name: "ถังทดสอบแก้ชนิดน้ำมัน",
      capacityLiters: 5000,
      currentLiters: 1200,
      lowAlertAt: 300,
    });
    const tank = (await t.db.query.fuelTanks.findMany()).find(
      row => row.name === "ถังทดสอบแก้ชนิดน้ำมัน"
    )!;

    await expect(
      t.caller("manager").catalog.updateTank({
        id: tank.id,
        productId: db7.id,
      })
    ).rejects.toThrow("admin");

    await t.caller("admin").catalog.updateTank({
      id: tank.id,
      productId: db7.id,
    });
    const updated = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, tank.id),
    });
    expect(updated!.productId).toBe(db7.id);

    const linkedDb7Tank = (await t.db.query.fuelTanks.findMany()).find(
      row => row.productId === db7.id && row.id !== tank.id
    )!;
    await expect(
      t.caller("admin").catalog.updateTank({
        id: linkedDb7Tank.id,
        productId: gsh91.id,
      })
    ).rejects.toThrow("ถังนี้ยังผูกกับหัวจ่ายอยู่");
  });

  it("ปิดกะแล้วตัดเฉพาะถังที่ admin ผูกไว้", async () => {
    const gsh95 = await t.db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    const nozzles = (await t.db.query.nozzles.findMany()).sort(
      (a, b) => a.id - b.id
    );
    const nozzle = nozzles.find(row => row.productId === gsh95!.id)!;
    const originalTank = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, nozzle.tankId!),
    });

    await t.caller("admin").catalog.createTank({
      productId: gsh95!.id,
      name: "ถัง GSH95 สำรอง",
      capacityLiters: 5000,
      currentLiters: 1000,
      lowAlertAt: 200,
    });
    const targetTank = (await t.db.query.fuelTanks.findMany()).find(
      tank => tank.name === "ถัง GSH95 สำรอง"
    )!;

    await t.caller("admin").catalog.updateNozzleMeter({
      id: nozzle.id,
      tankId: targetTank.id,
    });

    const pumps = await t.caller().catalog.listPumps();
    expect(
      pumps.flatMap(pump => pump.nozzles).find(row => row.id === nozzle.id)!
        .tank?.id
    ).toBe(targetTank.id);

    const { shiftId } = await t.caller().pos.openShift({
      staffName: "ทดสอบผูกถัง",
      readings: nozzles.map(row => ({
        nozzleId: row.id,
        openMeter: row.currentMeter,
        openMoney: row.currentMoney,
      })),
    });

    await expect(
      t.caller("admin").catalog.updateNozzleMeter({
        id: nozzle.id,
        tankId: originalTank!.id,
      })
    ).rejects.toThrow("กรุณาปิดกะก่อนเปลี่ยนสินค้า/ถังน้ำมัน");

    await t.caller().pos.closeShift({
      shiftId,
      readings: nozzles.map(row => ({
        nozzleId: row.id,
        closeMeter: row.currentMeter + (row.id === nozzle.id ? 15 : 0),
        closeMoney:
          row.currentMoney + (row.id === nozzle.id ? 15 * gsh95!.price : 0),
      })),
    });

    const originalAfter = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, originalTank!.id),
    });
    const targetAfter = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, targetTank.id),
    });
    expect(originalAfter!.currentLiters).toBe(originalTank!.currentLiters);
    expect(targetAfter!.currentLiters).toBe(985);

    await expect(
      t.caller("admin").catalog.deleteTank({ id: targetTank.id })
    ).rejects.toThrow("ถังนี้ยังผูกกับหัวจ่ายอยู่");
  });
});

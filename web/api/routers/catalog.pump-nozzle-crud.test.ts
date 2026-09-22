import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

describe("admin จัดการตู้จ่ายและหัวจ่าย", () => {
  it("เพิ่ม แก้ไข และลบตู้จ่ายกับหัวจ่ายได้เฉพาะ admin", async () => {
    await expect(
      test.caller("manager").catalog.createPump({ name: "ตู้ทดสอบ" })
    ).rejects.toThrow("admin");

    const createdPump = await test
      .caller("admin")
      .catalog.createPump({ name: "ตู้ทดสอบ" });
    expect(createdPump.pump?.name).toBe("ตู้ทดสอบ");

    await test.caller("admin").catalog.updatePump({
      id: createdPump.pump!.id,
      name: "ตู้ทดสอบแก้ไข",
    });

    const product = (await test.db.query.products.findMany()).find(
      row => row.category === "fuel"
    )!;
    const tank = (await test.db.query.fuelTanks.findMany()).find(
      row => row.productId === product.id
    )!;

    await expect(
      test.caller("cashier").catalog.createNozzle({
        pumpId: createdPump.pump!.id,
        productId: product.id,
        tankId: tank.id,
        label: "หัวทดสอบ",
        meter: 10,
        money: 20,
      })
    ).rejects.toThrow("admin");

    const createdNozzle = await test.caller("admin").catalog.createNozzle({
      pumpId: createdPump.pump!.id,
      productId: product.id,
      tankId: tank.id,
      label: "หัวทดสอบ",
      meter: 10,
      money: 20,
    });
    expect(createdNozzle.nozzle?.label).toBe("หัวทดสอบ");

    await test.caller("admin").catalog.updateNozzleMeter({
      id: createdNozzle.nozzle!.id,
      pumpId: createdPump.pump!.id,
      label: "หัวทดสอบแก้ไข",
      meter: 11,
      money: 22,
    });

    const pumps = await test.caller().catalog.listPumps();
    const pump = pumps.find(row => row.id === createdPump.pump!.id);
    expect(pump?.name).toBe("ตู้ทดสอบแก้ไข");
    expect(pump?.nozzles[0]).toMatchObject({
      id: createdNozzle.nozzle!.id,
      label: "หัวทดสอบแก้ไข",
      currentMeter: 11,
      currentMoney: 22,
    });

    await expect(
      test.caller("admin").catalog.deletePump({ id: createdPump.pump!.id })
    ).rejects.toThrow("ยังมีหัวจ่าย");

    await test
      .caller("admin")
      .catalog.deleteNozzle({ id: createdNozzle.nozzle!.id });
    await test.caller("admin").catalog.deletePump({ id: createdPump.pump!.id });

    const afterDelete = await test.caller().catalog.listPumps();
    expect(afterDelete.some(row => row.id === createdPump.pump!.id)).toBe(
      false
    );
  });

  it("ตรวจสาขา/ชนิดถัง และไม่ลบหัวจ่ายที่มีประวัติกะ", async () => {
    const admin = test.caller("admin");
    const createdPump = await admin.catalog.createPump({
      name: "ตู้เก็บประวัติ",
    });
    const products = await test.db.query.products.findMany();
    const fuelProducts = products.filter(row => row.category === "fuel");
    const firstProduct = fuelProducts[0]!;
    const anotherProduct = fuelProducts.find(
      row => row.id !== firstProduct.id
    )!;
    const tanks = await test.db.query.fuelTanks.findMany();
    const firstTank = tanks.find(row => row.productId === firstProduct.id)!;
    const anotherTank = tanks.find(row => row.productId === anotherProduct.id)!;

    await expect(
      admin.catalog.createNozzle({
        pumpId: createdPump.pump!.id,
        productId: firstProduct.id,
        tankId: anotherTank.id,
        label: "หัวถังไม่ตรง",
      })
    ).rejects.toThrow("ถังน้ำมันต้องเป็นชนิดเดียวกับสินค้า");

    const createdNozzle = await admin.catalog.createNozzle({
      pumpId: createdPump.pump!.id,
      productId: firstProduct.id,
      tankId: firstTank.id,
      label: "หัวมีประวัติ",
      meter: 100,
      money: 200,
    });
    const shift = await admin.pos.openShift({
      staffName: "ทดสอบประวัติหัวจ่าย",
      readings: [
        {
          nozzleId: createdNozzle.nozzle!.id,
          openMeter: 100,
          openMoney: 200,
        },
      ],
    });

    await expect(
      admin.catalog.deleteNozzle({ id: createdNozzle.nozzle!.id })
    ).rejects.toThrow("กรุณาปิดกะก่อนลบหัวจ่าย");

    await admin.pos.closeShift({
      shiftId: shift.shiftId,
      readings: [
        {
          nozzleId: createdNozzle.nozzle!.id,
          closeMeter: 100,
          closeMoney: 200,
        },
      ],
    });

    await expect(
      admin.catalog.deleteNozzle({ id: createdNozzle.nozzle!.id })
    ).rejects.toThrow("มีประวัติกะแล้ว");
  });
});

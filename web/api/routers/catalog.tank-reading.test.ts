import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { fuelTanks, products, tankReadings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

const gsh95Tank = async () => {
  const p = await t.db.query.products.findFirst({
    where: eq(products.code, "GSH95"),
  });
  return t.db.query.fuelTanks.findFirst({
    where: and(eq(fuelTanks.productId, p!.id), eq(fuelTanks.branchId, 1)),
  });
};

describe("catalog tank readings", () => {
  it("บันทึกค่าวัดได้ทุก role และ list เรียงล่าสุดก่อนโดยไม่เปลี่ยนยอดสต็อก", async () => {
    const tank = (await gsh95Tank())!;
    await t.caller("cashier").catalog.addTankReading({
      tankId: tank.id,
      liters: 9000,
      note: "วัดเช้า",
      adjustStock: false,
    });
    await t.caller("manager").catalog.addTankReading({
      tankId: tank.id,
      liters: 8800,
      adjustStock: false,
    });

    const list = await t.caller().catalog.listTankReadings();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.liters).toBe(8800);
    expect(list[0]!.tank?.id).toBe(tank.id);
    expect(list[0]!.staffName).toBeTruthy();
    expect(list[1]!.liters).toBe(9000);
    expect(list[1]!.note).toBe("วัดเช้า");

    const after = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, tank.id),
    });
    expect(after!.currentLiters).toBe(tank.currentLiters);
  });

  it("adjustStock ปรับยอดตามค่าวัด และปฏิเสธค่าที่เกินความจุถัง", async () => {
    const tank = (await gsh95Tank())!;
    await expect(
      t.caller("manager").catalog.addTankReading({
        tankId: tank.id,
        liters: tank.capacityLiters + 1,
        adjustStock: true,
      })
    ).rejects.toThrow("เกินความจุถัง");

    await t.caller("manager").catalog.addTankReading({
      tankId: tank.id,
      liters: 8500,
      note: "ปรับยอดตามค่าวัด",
      adjustStock: true,
    });
    const after = await t.db.query.fuelTanks.findFirst({
      where: eq(fuelTanks.id, tank.id),
    });
    expect(after!.currentLiters).toBe(8500);
  });

  it("วัดถังสาขาอื่นไม่ได้ และลบค่าวัดได้เฉพาะ admin", async () => {
    const tank = (await gsh95Tank())!;
    const created = await t.caller("admin").auth.createBranch({
      code: "READING-BR2",
      name: "สาขาทดสอบค่าวัด",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    await expect(
      t.caller("admin", 1, created.branch.id).catalog.addTankReading({
        tankId: tank.id,
        liters: 1,
        adjustStock: false,
      })
    ).rejects.toThrow("ไม่พบถัง");

    await t.caller("admin").catalog.addTankReading({
      tankId: tank.id,
      liters: 8400,
      adjustStock: false,
    });
    const inserted = await t.db.query.tankReadings.findFirst({
      where: eq(tankReadings.tankId, tank.id),
      orderBy: desc(tankReadings.id),
    });
    expect(inserted).toBeDefined();

    await expect(
      t.caller("manager").catalog.deleteTankReading({ id: inserted!.id })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    await t.caller("admin").catalog.deleteTankReading({ id: inserted!.id });
    const gone = await t.db.query.tankReadings.findFirst({
      where: eq(tankReadings.id, inserted!.id),
    });
    expect(gone).toBeUndefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { fuelTanks, products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสเปิด–ปิดกะและมิเตอร์ บนฐานข้อมูลชั่วคราว (migrate + seed)
// seed: หัวจ่าย 4 ตัว (GSH95/DB7/GSH91/DB7) ถัง GSH95 = 12,450 ลิตร, ราคา GSH95 = 40.74
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const allNozzles = async () => (await t.db.query.nozzles.findMany()).sort((a, b) => a.id - b.id);
const tankOf = async (code: string) => {
  const p = await t.db.query.products.findFirst({ where: eq(products.code, code) });
  return t.db.query.fuelTanks.findFirst({ where: eq(fuelTanks.productId, p!.id) });
};

describe("openShift / closeShift", () => {
  it("เปิดกะบันทึกมิเตอร์ตั้งต้นและราคาต่อลิตรของแต่ละหัวจ่าย", async () => {
    const nz = await allNozzles();
    const { shiftId } = await t.caller().pos.openShift({
      staffName: "สมชาย",
      readings: nz.map((n) => ({ nozzleId: n.id, openMeter: n.currentMeter, openMoney: n.currentMoney })),
    });

    const cur = await t.caller().pos.currentShift();
    expect(cur!.id).toBe(shiftId);
    expect(cur!.readings).toHaveLength(4);
    const r1 = cur!.readings.find((r) => r.nozzleId === nz[0]!.id)!;
    expect(r1.openMeter).toBe(152340.5);
    expect(r1.pricePerLiter).toBe(40.74); // snapshot ราคาตอนเปิดกะ
  });

  it("เปิดกะซ้ำตอนมีกะเปิดอยู่ → error", async () => {
    const nz = await allNozzles();
    await expect(
      t.caller().pos.openShift({
        staffName: "ซ้ำ",
        readings: [{ nozzleId: nz[0]!.id, openMeter: 0, openMoney: 0 }],
      }),
    ).rejects.toThrow("มีกะที่เปิดอยู่แล้ว");
  });

  it("ปิดกะด้วยมิเตอร์ต่ำกว่าตั้งต้น → error", async () => {
    const cur = await t.caller().pos.currentShift();
    const nz = await allNozzles();
    await expect(
      t.caller().pos.closeShift({
        shiftId: cur!.id,
        readings: [{ nozzleId: nz[0]!.id, closeMeter: 0, closeMoney: 99999999 }],
      }),
    ).rejects.toThrow("เลขลิตรปิดกะต้องมากกว่าหรือเท่าเลขตั้งต้น");
  });

  it("ปิดกะสำเร็จ: คำนวณลิตร/ยอดเงิน/ยอด P, เทียบยอด POS และหักถัง", async () => {
    const cur = await t.caller().pos.currentShift();
    const nz = await allNozzles();
    const tankBefore = (await tankOf("GSH95"))!;

    // ขายในกะ 20 บาท → posAmount ของกะ
    const water = await t.db.query.products.findFirst({ where: eq(products.code, "WATER") });
    await t.caller().pos.createSale({ shiftId: cur!.id, items: [{ productId: water!.id, qty: 2 }] });

    // หัวจ่าย 1 ขายไป 25 ลิตร (25 × 40.74 = 1,018.50) หัวจ่ายอื่นไม่ขาย
    const res = await t.caller().pos.closeShift({
      shiftId: cur!.id,
      readings: nz.map((n, i) => ({
        nozzleId: n.id,
        closeMeter: n.currentMeter + (i === 0 ? 25 : 0),
        closeMoney: n.currentMoney + (i === 0 ? 1018.5 : 0),
      })),
    });

    expect(res.totalLiters).toBe(25);
    expect(res.totalAmount).toBe(1018.5);
    expect(res.totalMoneyMeter).toBe(1018.5);
    expect(res.diff).toBe(0); // P เท่ากับ ลิตร × ราคา

    // กะปิดแล้ว + ยอด POS ในกะ
    const hist = await t.caller().pos.shiftHistory();
    const closed = hist.find((s) => s.id === cur!.id)!;
    expect(closed.status).toBe("closed");
    expect(closed.posAmount).toBe(20);

    // มิเตอร์หัวจ่ายอัปเดต และถัง GSH95 ถูกหัก 25 ลิตร
    expect((await allNozzles())[0]!.currentMeter).toBe(152365.5);
    expect((await tankOf("GSH95"))!.currentLiters).toBe(tankBefore.currentLiters - 25);

    // ไม่มีกะเปิดค้าง
    expect(await t.caller().pos.currentShift()).toBeNull();
  });

  it("กะที่เปิดด้วย P = 0 จะข้ามการเทียบยอด P (ยอดเงินนับจากลิตรอย่างเดียว)", async () => {
    const nz = await allNozzles();
    const { shiftId } = await t.caller().pos.openShift({
      staffName: "กะเย็น",
      readings: nz.map((n) => ({ nozzleId: n.id, openMeter: n.currentMeter, openMoney: 0 })),
    });

    const res = await t.caller().pos.closeShift({
      shiftId,
      readings: nz.map((n, i) => ({
        nozzleId: n.id,
        closeMeter: n.currentMeter + (i === 0 ? 10 : 0),
        closeMoney: 5000, // จด P ปลายทางไว้ให้กะถัดไป แต่รอบนี้ไม่นำมาคิด
      })),
    });

    expect(res.totalLiters).toBe(10);
    expect(res.totalAmount).toBe(407.4); // 10 × 40.74
    expect(res.totalMoneyMeter).toBe(0);
    // แต่ P ปลายทางถูกบันทึกลงหัวจ่าย
    expect((await allNozzles())[0]!.currentMoney).toBe(5000);
  });

  it("ปิดกะที่ไม่มีอยู่จริง → error", async () => {
    await expect(
      t.caller().pos.closeShift({
        shiftId: 99999,
        readings: [{ nozzleId: 1, closeMeter: 1, closeMoney: 1 }],
      }),
    ).rejects.toThrow("ไม่พบกะที่เปิดอยู่");
  });
});

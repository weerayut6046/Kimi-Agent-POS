import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสระบบบันทึกค่าใช้จ่ายหน้าร้าน ผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed)
// create ต้องผูกกะที่เปิดอยู่อัตโนมัติ, update/remove สงวนสิทธิ์ admin/manager
let t: TestDb;
let shiftId: number;

/** วันนี้ "YYYY-MM-DD" แบบ local (ฝั่ง client ส่งรูปแบบนี้) */
const todayStr = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

beforeAll(async () => {
  t = await setupTestDb();
  // เปิดกะไว้ก่อน — ค่าใช้จ่ายที่สร้างต้องผูกกะนี้
  const nozzles = await t.db.query.nozzles.findMany();
  const res = await t.caller().pos.openShift({
    staffName: "กะเช้า",
    readings: nozzles.map((n) => ({ nozzleId: n.id, openMeter: n.currentMeter, openMoney: n.currentMoney })),
  });
  shiftId = res.shiftId;
});
afterAll(() => t.cleanup());

describe("บันทึกค่าใช้จ่าย", () => {
  it("create ผูกกะที่เปิดอยู่อัตโนมัติ และ list ของวันนั้นรวมยอดถูก", async () => {
    const created = await t.caller().expenses.create({
      title: "ค่าน้ำแข็ง",
      category: "วัตถุดิบ",
      amount: 100,
      staffName: "สมชาย",
      note: "ถุงใหญ่",
    });
    expect(created!.shiftId).toBe(shiftId);
    expect(created!.amount).toBe(100);
    expect(created!.staffName).toBe("สมชาย");

    // เว้นจังหวะให้ createdAt ต่างมิลลิวินาที ไม่อย่างนั้นลำดับใหม่→เก่าไม่นิ่ง
    await new Promise((r) => setTimeout(r, 10));
    await t.caller().expenses.create({ title: "ค่าถุง", amount: 50 });

    const list = await t.caller().expenses.list({ date: todayStr() });
    expect(list.items).toHaveLength(2);
    expect(list.total).toBe(150);
    // เรียงใหม่ → เก่า
    expect(list.items[0]!.title).toBe("ค่าถุง");
  });

  it("ไม่มีกะเปิดก็บันทึกได้ (shiftId = null)", async () => {
    // ปิดกะชั่วคราวแล้วสร้าง → shiftId ต้องเป็น null
    const nz = (await t.db.query.nozzles.findMany()).sort((a, b) => a.id - b.id);
    await t.caller().pos.closeShift({
      shiftId,
      readings: nz.map((n) => ({ nozzleId: n.id, closeMeter: n.currentMeter, closeMoney: n.currentMoney })),
    });
    const created = await t.caller().expenses.create({ title: "ค่าแรงชั่วคราว", amount: 300 });
    expect(created!.shiftId).toBeNull();
    // เปิดกะกลับเพื่อไม่ให้กระทบเทสอื่นในไฟล์นี้
    const res = await t.caller().pos.openShift({
      staffName: "กะบ่าย",
      readings: nz.map((n) => ({ nozzleId: n.id, openMeter: n.currentMeter, openMoney: n.currentMoney })),
    });
    shiftId = res.shiftId;
  });

  it("list วันอื่น → ไม่มีรายการ, ค้นหาด้วย q เจอเฉพาะที่ตรง", async () => {
    const otherDay = await t.caller().expenses.list({ date: "2000-01-01" });
    expect(otherDay.items).toHaveLength(0);
    expect(otherDay.total).toBe(0);

    const byTitle = await t.caller().expenses.list({ date: todayStr(), q: "น้ำแข็ง" });
    expect(byTitle.items).toHaveLength(1);
    expect(byTitle.total).toBe(100);

    const byCategory = await t.caller().expenses.list({ date: todayStr(), q: "วัตถุดิบ" });
    expect(byCategory.items).toHaveLength(1);
  });

  it("cashier update/remove → error สิทธิ์ไม่เพียงพอ", async () => {
    const created = await t.caller().expenses.create({ title: "ของใช้สำนักงาน", amount: 80 });
    await expect(t.caller("cashier").expenses.update({ id: created!.id, amount: 90 })).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ",
    );
    await expect(t.caller("cashier").expenses.remove({ id: created!.id })).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ",
    );
  });

  it("manager update แก้เฉพาะ field ที่ส่ง / update id ที่ไม่มี → error", async () => {
    const created = await t.caller().expenses.create({ title: "ค่าน้ำประปา", category: "สาธารณูปโภค", amount: 120 });
    const updated = await t.caller("manager").expenses.update({ id: created!.id, amount: 99.5 });
    expect(updated!.amount).toBe(99.5);
    expect(updated!.title).toBe("ค่าน้ำประปา"); // ไม่ได้ส่งมา → คงเดิม
    expect(updated!.category).toBe("สาธารณูปโภค");

    await expect(t.caller("manager").expenses.update({ id: 99999, title: "x" })).rejects.toThrow(
      "ไม่พบรายการค่าใช้จ่าย",
    );
  });

  it("manager remove สำเร็จ / ลบซ้ำ → error", async () => {
    const created = await t.caller().expenses.create({ title: "ค่าขยะ", amount: 30 });
    await expect(t.caller("manager").expenses.remove({ id: created!.id })).resolves.toEqual({ ok: true });
    await expect(t.caller("manager").expenses.remove({ id: created!.id })).rejects.toThrow(
      "ไม่พบรายการค่าใช้จ่าย",
    );

    const list = await t.caller().expenses.list({ date: todayStr() });
    expect(list.items.find((e) => e.title === "ค่าขยะ")).toBeUndefined();
  });
});

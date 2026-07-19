import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสรายงานปิดวัน (Z-report) ผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed)
// seed: WATER 10฿ / TISSUE 20฿ / GSH95 น้ำมัน 40.74฿/ลิตร
let t: TestDb;

/** วันนี้ "YYYY-MM-DD" แบบ local (ฝั่ง client ส่งรูปแบบนี้) */
const todayStr = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const productByCode = async (code: string) => {
  const p = await t.db.query.products.findFirst({ where: eq(products.code, code) });
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ใน seed`);
  return p;
};

/** parse base64 → workbook (cast เพราะ typings ของ exceljs ใช้ Buffer เวอร์ชันเก่ากว่า @types/node ปัจจุบัน) */
const parseXlsx = async (contentBase64: string) => {
  const wb = new ExcelJS.Workbook();
  const buf = Buffer.from(contentBase64, "base64");
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return { wb, buf };
};

describe("reports.daily — Z-report", () => {
  it("สรุปยอดของวันถูกต้อง: บิลหลาย method + บิลยกเลิก + ค่าใช้จ่าย + รับชำระหนี้", async () => {
    const water = await productByCode("WATER");
    const tissue = await productByCode("TISSUE");
    const gsh95 = await productByCode("GSH95");
    const cust = await t.caller("manager").customers.create({ name: "ลูกค้าทดสอบ Z" });

    // บิล A: เงินสด 20 − ส่วนลด 5 = 15
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 2 }],
      discount: 5,
      paymentMethod: "cash",
      received: 20,
    });
    // บิล B: QR 20
    await t.caller().pos.createSale({
      items: [{ productId: tissue.id, qty: 1 }],
      paymentMethod: "qr",
    });
    // บิล C: QR น้ำมัน 10 ลิตร = 407.40
    await t.caller().pos.createSale({
      items: [{ productId: gsh95.id, qty: 10 }],
      paymentMethod: "qr",
    });
    // บิล D: เครดิต 30 (ต้องมีลูกค้า)
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 3 }],
      paymentMethod: "credit",
      customerId: cust!.id,
    });
    // บิล E: เงินสด 10 → ยกเลิก
    const { sale: voidedSale } = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }],
      paymentMethod: "cash",
      received: 10,
    });
    await t.caller("admin").pos.voidSale({ id: voidedSale.id });

    // ค่าใช้จ่าย 15 + รับชำระหนี้เงินสด 12
    await t.caller().expenses.create({ title: "ค่าน้ำแข็ง", category: "วัตถุดิบ", amount: 15 });
    await t.caller().credit.receivePayment({ customerId: cust!.id, amount: 12, method: "cash", staffName: "ผู้จัดการ" });

    const r = await t.caller().reports.daily({ date: todayStr() });

    // ยอดขาย: 15 + 20 + 407.40 + 30 = 472.40 (เฉพาะ completed)
    expect(r.totalSales).toBe(472.4);
    expect(r.billCount).toBe(4);
    expect(r.voidedCount).toBe(1);
    expect(r.voidedTotal).toBe(10);
    expect(r.discountTotal).toBe(5);
    // VAT รวมใน 7%: 15→0.98, 20→1.31, 407.40→26.65, 30→1.96
    expect(r.vatTotal).toBe(30.9);

    // แยกวิธีชำระ (เฉพาะ completed)
    expect(r.byMethod.cash).toEqual({ count: 1, total: 15 });
    expect(r.byMethod.qr).toEqual({ count: 2, total: 427.4 });
    expect(r.byMethod.card).toEqual({ count: 0, total: 0 });
    expect(r.byMethod.credit).toEqual({ count: 1, total: 30 });

    // ลิตรน้ำมัน (เฉพาะสินค้าหมวด fuel ของบิล completed)
    expect(r.fuelLiters).toEqual([{ name: gsh95.name, liters: 10 }]);
    expect(r.totalLiters).toBe(10);

    // ค่าใช้จ่าย / รับชำระหนี้
    expect(r.expenses.items).toHaveLength(1);
    expect(r.expenses.total).toBe(15);
    expect(r.debtPayments.items).toHaveLength(1);
    expect(r.debtPayments.items[0]!.customerName).toBe("ลูกค้าทดสอบ Z");
    expect(r.debtPayments.total).toBe(12);
    expect(r.debtPayments.byMethod).toEqual({ cash: 12, qr: 0, transfer: 0 });

    // เงินสดที่ควรมี = ขายเงินสด 15 + ชำระหนี้เงินสด 12 − ค่าใช้จ่าย 15
    expect(r.expectedCash).toBe(12);

    // ไฟล์เทสนี้ไม่ได้เปิดกะ → ต้องไม่มีกะ
    expect(r.shifts).toHaveLength(0);
  });

  it("ข้ามไปวันอื่น → ทุกยอดเป็นศูนย์", async () => {
    const r = await t.caller().reports.daily({ date: "2000-01-01" });
    expect(r.totalSales).toBe(0);
    expect(r.billCount).toBe(0);
    expect(r.voidedCount).toBe(0);
    expect(r.voidedTotal).toBe(0);
    expect(r.fuelLiters).toHaveLength(0);
    expect(r.totalLiters).toBe(0);
    expect(r.expenses.total).toBe(0);
    expect(r.debtPayments.total).toBe(0);
    expect(r.expectedCash).toBe(0);
  });

  it("รูปแบบวันที่ไม่ถูกต้อง → error", async () => {
    await expect(t.caller().reports.daily({ date: "18/07/2026" })).rejects.toThrow();
  });
});

// อาศัยข้อมูลจาก describe ก่อนหน้า: วันนี้มีบิลน้ำมัน GSH95 10 ลิตร = 407.40 (cost 39.2/ลิตร)
describe("reports.fuelProfit — กำไรต่อลิตร", () => {
  it("คำนวณกำไรจากต้นทุนสินค้าปัจจุบัน", async () => {
    const r = await t.caller("manager").reports.fuelProfit({ date: todayStr() });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      name: "แก๊สโซฮอล์ 95",
      liters: 10,
      revenue: 407.4,
      costPerLiter: 39.2,
      profitPerLiter: 1.54,
      profitTotal: 15.4,
    });
  });

  it("cashier เรียกไม่ได้ (มีข้อมูลต้นทุน)", async () => {
    await expect(t.caller("cashier").reports.fuelProfit({ date: todayStr() })).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

describe("reports.export*Excel — ส่งออกไฟล์", () => {
  it("exportDailyExcel คืน xlsx ถูกต้อง ครบทุก sheet", async () => {
    const res = await t.caller("admin").reports.exportDailyExcel({ date: todayStr() });
    expect(res.fileName).toBe(`zreport-${todayStr()}.xlsx`);
    const { wb, buf } = await parseXlsx(res.contentBase64);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // zip/xlsx magic
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "สรุป",
      "ลิตรและกำไรน้ำมัน",
      "กะการทำงาน",
      "ค่าใช้จ่าย",
      "ชำระหนี้",
      "บิลขาย",
    ]);
  });

  it("exportRangeExcel วันเดียว → sheet สรุปรายวัน/บิลขาย/กำไร", async () => {
    const res = await t.caller("manager").reports.exportRangeExcel({ from: todayStr(), to: todayStr() });
    expect(res.fileName).toContain("sales-");
    const { wb } = await parseXlsx(res.contentBase64);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["สรุปรายวัน", "บิลขาย", "ลิตรและกำไรน้ำมัน"]);
    // title + ว่าง + header + ข้อมูล 1 วัน + แถวรวม
    expect(wb.getWorksheet("สรุปรายวัน")!.rowCount).toBe(5);
  });

  it("exportRangeExcel ปฏิเสธช่วงเกิน 92 วัน / วันสิ้นสุดก่อนวันเริ่ม", async () => {
    await expect(
      t.caller("admin").reports.exportRangeExcel({ from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toThrow("92");
    await expect(
      t.caller("admin").reports.exportRangeExcel({ from: "2026-07-10", to: "2026-07-01" }),
    ).rejects.toThrow("สิ้นสุด");
  });

  it("cashier ส่งออกไม่ได้", async () => {
    await expect(t.caller("cashier").reports.exportDailyExcel({ date: todayStr() })).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ",
    );
  });
});

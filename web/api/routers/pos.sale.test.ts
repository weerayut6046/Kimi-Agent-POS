import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { products, members, saleItems, sales } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสการขายผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed เหมือน production)
// ข้อมูล seed ที่ใช้: WATER 10฿ สต๊อก 120, TISSUE 20฿ สต๊อก 40, GSH95 40.74฿/ลิตร (fuel)
// สมาชิก M0001 มี 320 แต้ม, VAT 7% รวมใน, ได้แต้มทุก 25 บาท, แต้มลดได้แต้มละ 1 บาท
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const productByCode = async (code: string) => {
  const p = await t.db.query.products.findFirst({
    where: eq(products.code, code),
  });
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ใน seed`);
  return p;
};
const memberByCode = async (code: string) => {
  const m = await t.db.query.members.findFirst({
    where: eq(members.memberCode, code),
  });
  if (!m) throw new Error(`ไม่พบสมาชิก ${code} ใน seed`);
  return m;
};

describe("createSale", () => {
  it("คำนวณยอดรวม VAT (รวมใน) เงินทอน และหักสต๊อกสินค้าทั่วไป", async () => {
    const water = await productByCode("WATER");
    const tissue = await productByCode("TISSUE");

    const { sale, items } = await t.caller().pos.createSale({
      staffName: "ทดสอบ",
      items: [
        { productId: water.id, qty: 2 },
        { productId: tissue.id, qty: 1 },
      ],
      paymentMethod: "cash",
      received: 100,
    });

    expect(sale.subtotal).toBe(40);
    expect(sale.total).toBe(40);
    expect(sale.vatAmount).toBe(2.62); // 40 × 7 / 107
    expect(sale.changeAmt).toBe(60);
    expect(sale.receiptNo).toMatch(/^R\d{5}$/);
    expect(items).toHaveLength(2);

    // สต๊อกถูกหักตามจำนวนขาย
    const waterAfter = await productByCode("WATER");
    const tissueAfter = await productByCode("TISSUE");
    expect(waterAfter.stockQty).toBe(water.stockQty - 2);
    expect(tissueAfter.stockQty).toBe(tissue.stockQty - 1);
  });

  it("ขายน้ำมันไม่หักสต๊อกสินค้า (น้ำมันหักผ่านถังตอนปิดกะ)", async () => {
    const gsh95 = await productByCode("GSH95");
    const { sale, items } = await t.caller().pos.createSale({
      items: [{ productId: gsh95.id, qty: 10 }],
      paymentMethod: "qr",
    });

    expect(sale.total).toBe(407.4); // 10 × 40.74
    expect(items[0]!.unit).toBe("ลิตร");
    // ชำระไม่ใช่เงินสด → received = total, ไม่มีเงินทอน
    expect(sale.received).toBe(407.4);
    expect(sale.changeAmt).toBe(0);
    expect((await productByCode("GSH95")).stockQty).toBe(gsh95.stockQty);
  });

  it("ส่วนลดมากกว่ายอดขาย → error", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 1 }],
        discount: 999,
      })
    ).rejects.toThrow("ส่วนลดมากกว่ายอดขาย");
  });

  it("เลขใบเสร็จ running ต่อเนื่องทีละ 1", async () => {
    const water = await productByCode("WATER");
    const a = await t
      .caller()
      .pos.createSale({ items: [{ productId: water.id, qty: 1 }] });
    const b = await t
      .caller()
      .pos.createSale({ items: [{ productId: water.id, qty: 1 }] });
    const no = (r: string) => Number(r.replace(/\D/g, ""));
    expect(no(b.sale.receiptNo)).toBe(no(a.sale.receiptNo) + 1);
  });

  it("ซิงก์บิลออฟไลน์ซ้ำไม่สร้างบิล หักสต๊อก หรือเพิ่มแต้มซ้ำ", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    const clientReceiptNo = "OFF-ABC123-20260721162539-0001";
    const input = {
      clientReceiptNo,
      clientCreatedAt: new Date("2026-07-21T09:25:39.000Z"),
      staffName: "พนักงานออฟไลน์",
      memberId: member.id,
      items: [{ productId: water.id, qty: 5 }],
      paymentMethod: "cash" as const,
      received: 100,
    };

    const first = await t.caller().pos.createSale(input);
    const second = await t.caller().pos.createSale(input);

    expect(second.sale.id).toBe(first.sale.id);
    expect(second.sale.receiptNo).toBe(clientReceiptNo);
    expect((await productByCode("WATER")).stockQty).toBe(water.stockQty - 5);
    expect((await memberByCode("M0001")).points).toBe(member.points + 2);

    const matchingSales = await t.db
      .select()
      .from(sales)
      .where(eq(sales.receiptNo, clientReceiptNo));
    const matchingItems = await t.db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, first.sale.id));
    expect(matchingSales).toHaveLength(1);
    expect(matchingItems).toHaveLength(1);
  });

  it("สมาชิกได้แต้มตามยอดขาย (ทุก 25 บาท = 1 แต้ม)", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");

    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 4 }], // 40 บาท
    });

    expect(sale.pointsEarned).toBe(1); // floor(40/25)
    expect((await memberByCode("M0001")).points).toBe(member.points + 1);
  });

  it("ใช้แต้มเป็นส่วนลด และหักแต้มจากสมาชิก", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");

    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 10 }], // 100 บาท
      pointsToRedeem: 50,
    });

    expect(sale.discount).toBe(50); // 50 แต้ม × 1 บาท
    expect(sale.total).toBe(50);
    expect(sale.pointsRedeemed).toBe(50);
    expect(sale.pointsEarned).toBe(2); // floor(50/25)
    // หัก 50 ที่ใช้ บวก 2 ที่ได้
    expect((await memberByCode("M0001")).points).toBe(member.points - 50 + 2);
  });

  it("ใช้แต้มเกินที่มี → error", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    await expect(
      t.caller().pos.createSale({
        memberId: member.id,
        items: [{ productId: water.id, qty: 1 }],
        pointsToRedeem: member.points + 1,
      })
    ).rejects.toThrow("แต้มไม่พอ");
  });
});

describe("voidSale", () => {
  it("cashier ยกเลิกบิลไม่ได้ (สงวนสิทธิ์ admin)", async () => {
    const water = await productByCode("WATER");
    const { sale } = await t
      .caller()
      .pos.createSale({ items: [{ productId: water.id, qty: 1 }] });
    await expect(
      t.caller("cashier").pos.voidSale({ id: sale.id })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });

  it("admin ยกเลิกบิลแล้วคืนสต๊อกและแต้ม", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 10 }], // 100 − 20 = 80 บาท → ได้ 3 แต้ม
      pointsToRedeem: 20,
    });
    const pointsAfterSale = (await memberByCode("M0001")).points;
    const stockAfterSale = (await productByCode("WATER")).stockQty;

    await t.caller("admin").pos.voidSale({ id: sale.id });

    // แต้มกลับเท่าก่อนขาย: คืนแต้มที่ใช้ หักแต้มที่ได้จากบิล
    expect((await memberByCode("M0001")).points).toBe(
      pointsAfterSale + sale.pointsRedeemed - sale.pointsEarned
    );
    expect((await productByCode("WATER")).stockQty).toBe(stockAfterSale + 10);

    const detail = await t.caller().pos.saleDetail({ id: sale.id });
    expect(detail.sale.status).toBe("voided");
  });

  it("ยกเลิกบิลซ้ำไม่ได้", async () => {
    const water = await productByCode("WATER");
    const { sale } = await t
      .caller()
      .pos.createSale({ items: [{ productId: water.id, qty: 1 }] });
    await t.caller("admin").pos.voidSale({ id: sale.id });
    await expect(
      t.caller("admin").pos.voidSale({ id: sale.id })
    ).rejects.toThrow("ยกเลิกบิลไม่ได้");
  });
});

describe("updateSale", () => {
  it("แก้ส่วนลดแล้วคำนวณยอดสุทธิ/VAT/แต้มใหม่", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 10 }], // 100 บาท → 4 แต้ม
    });
    const pointsAfterSale = (await memberByCode("M0001")).points;

    const updated = await t
      .caller("manager")
      .pos.updateSale({ id: sale.id, discount: 25 });

    expect(updated!.total).toBe(75);
    expect(updated!.vatAmount).toBe(4.91); // 75 × 7 / 107
    expect(updated!.pointsEarned).toBe(3); // floor(75/25)
    // แต้มปรับเฉพาะส่วนต่าง 4 → 3
    expect((await memberByCode("M0001")).points).toBe(pointsAfterSale - 1);
  });

  it("cashier แก้ไขบิลไม่ได้", async () => {
    const water = await productByCode("WATER");
    const { sale } = await t
      .caller()
      .pos.createSale({ items: [{ productId: water.id, qty: 1 }] });
    await expect(
      t.caller("cashier").pos.updateSale({ id: sale.id, discount: 5 })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

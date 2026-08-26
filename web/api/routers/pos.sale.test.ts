import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  branches,
  products,
  members,
  pointTransactions,
  saleItems,
  sales,
  settings,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { bangkokDateKey } from "@contracts/promotion";

// เทสการขายผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed เหมือน production)
// ข้อมูล seed ที่ใช้: WATER 10฿ สต๊อก 120, TISSUE 20฿ สต๊อก 40, GSH95 40.74฿/ลิตร (fuel)
// สมาชิก M0001 มี 320 แต้ม, VAT 7% รวมใน, ได้แต้มทุก 100 บาท, แต้มลดได้แต้มละ 1 บาท
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db
    .update(settings)
    .set({ value: "0" })
    .where(
      and(eq(settings.branchId, 1), eq(settings.key, "promotion_enabled"))
    );
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

const setPromotion = async (enabled: boolean) => {
  const today = bangkokDateKey(new Date());
  const values: Record<string, string> = {
    promotion_enabled: enabled ? "1" : "0",
    promotion_name: "โปรโมชั่นทดสอบ",
    promotion_discount: "0.50",
    promotion_start_date: today,
    promotion_end_date: today,
  };
  for (const [key, value] of Object.entries(values)) {
    await t.db
      .update(settings)
      .set({ value })
      .where(and(eq(settings.branchId, 1), eq(settings.key, key)));
  }
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

  it("ช่วงโปรโมชั่นใช้เฉพาะส่วนลดโปรโมชั่นและไม่สะสมหรือใช้แต้ม", async () => {
    const gsh95 = await productByCode("GSH95");
    const member = await memberByCode("M0001");
    const pointsBefore = member.points;
    await setPromotion(true);

    try {
      const { sale } = await t.caller().pos.createSale({
        memberId: member.id,
        items: [{ productId: gsh95.id, qty: 10 }],
        discount: 100,
        loyaltyChoice: "earn",
        paymentMethod: "qr",
      });

      expect(sale.subtotal).toBe(407.4);
      expect(sale.discount).toBe(5);
      expect(sale.total).toBe(402.4);
      expect(sale.pointsEarned).toBe(0);
      expect(sale.pointsRedeemed).toBe(0);
      expect((await memberByCode("M0001")).points).toBe(pointsBefore);
      expect(
        await t.db
          .select()
          .from(pointTransactions)
          .where(eq(pointTransactions.saleId, sale.id))
      ).toHaveLength(0);

      await expect(
        t.caller().pos.createSale({
          memberId: member.id,
          items: [{ productId: gsh95.id, qty: 1 }],
          pointsToRedeem: 1,
          loyaltyChoice: "redeem",
        })
      ).rejects.toThrow("ช่วงโปรโมชั่นไม่สามารถใช้แต้ม");
    } finally {
      await setPromotion(false);
    }
  });

  it("สินค้าหมดหรือจำนวนเกินสต๊อกขายไม่ได้และสต๊อกไม่ติดลบ", async () => {
    await t.caller("admin").catalog.createProduct({
      code: "SOLD-OUT-TEST",
      name: "สินค้าหมดทดสอบ",
      category: "other",
      unit: "ชิ้น",
      price: 25,
      cost: 10,
      stockQty: 0,
      lowStockAt: 1,
    });
    await t.caller("admin").catalog.createProduct({
      code: "LIMITED-STOCK-TEST",
      name: "สินค้าสต๊อกจำกัด",
      category: "lubricant",
      unit: "ขวด",
      price: 100,
      cost: 60,
      stockQty: 1,
      lowStockAt: 1,
    });
    const soldOut = await productByCode("SOLD-OUT-TEST");
    const limited = await productByCode("LIMITED-STOCK-TEST");

    await expect(
      t.caller().pos.createSale({
        items: [{ productId: soldOut.id, qty: 1 }],
      })
    ).rejects.toThrow("หมดแล้ว ไม่สามารถขายได้");
    await expect(
      t.caller().pos.createSale({
        items: [
          { productId: limited.id, qty: 0.6 },
          { productId: limited.id, qty: 0.6 },
        ],
      })
    ).rejects.toThrow("สต๊อก");

    expect((await productByCode("SOLD-OUT-TEST")).stockQty).toBe(0);
    expect((await productByCode("LIMITED-STOCK-TEST")).stockQty).toBe(1);
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
      items: [{ productId: water.id, qty: 10 }],
      paymentMethod: "cash" as const,
      received: 100,
    };

    const first = await t.caller().pos.createSale(input);
    const second = await t.caller().pos.createSale(input);

    expect(second.sale.id).toBe(first.sale.id);
    expect(second.sale.receiptNo).toBe(clientReceiptNo);
    expect((await productByCode("WATER")).stockQty).toBe(water.stockQty - 10);
    expect((await memberByCode("M0001")).points).toBe(member.points + 1);

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

  it("สมาชิกได้แต้มตามยอดขาย (ทุก 100 บาท = 1 แต้ม)", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");

    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 10 }], // 100 บาท
    });

    expect(sale.pointsEarned).toBe(1); // floor(100/100)
    expect((await memberByCode("M0001")).points).toBe(member.points + 1);
  });

  it("ใช้แต้มเป็นส่วนลด และหักแต้มจากสมาชิก", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");

    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 20 }], // 200 บาท
      pointsToRedeem: 50,
      loyaltyChoice: "redeem",
    });

    expect(sale.discount).toBe(50); // 50 แต้ม × 1 บาท
    expect(sale.total).toBe(150);
    expect(sale.pointsRedeemed).toBe(50);
    expect(sale.pointsEarned).toBe(0); // เลือกใช้แต้มแล้วจะไม่สะสมแต้มในบิลเดียวกัน
    expect((await memberByCode("M0001")).points).toBe(member.points - 50);
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

  it("ใช้แต้มโดยไม่เลือกสมาชิกไม่ได้", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 10 }],
        pointsToRedeem: 1,
      })
    ).rejects.toThrow("ต้องเลือกสมาชิกก่อนใช้แต้ม");
  });

  it("ใช้แต้มเป็นส่วนลดท้ายบิลเกินยอดขายไม่ได้", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    await expect(
      t.caller().pos.createSale({
        memberId: member.id,
        items: [{ productId: water.id, qty: 1 }],
        pointsToRedeem: 11,
      })
    ).rejects.toThrow("ส่วนลดมากกว่ายอดขาย");
  });

  it("สมาชิกใช้ยอดแต้มบัญชีเดียวกันซื้อสินค้าข้ามสาขาได้", async () => {
    const [secondBranch] = await t.db
      .insert(branches)
      .values({ code: "CROSS-POINT", name: "สาขาทดสอบแต้มร่วม" })
      .returning();
    const [branchProduct] = await t.db
      .insert(products)
      .values({
        branchId: secondBranch!.id,
        code: "CROSS-POINT-WATER",
        name: "น้ำดื่มสาขาทดสอบ",
        category: "other",
        unit: "ขวด",
        price: 10,
        cost: 5,
        stockQty: 20,
        lowStockAt: 2,
      })
      .returning();
    await t.db.insert(settings).values({
      branchId: secondBranch!.id,
      key: "promotion_enabled",
      value: "0",
    });
    const member = await memberByCode("M0001");

    const searchFromSecondBranch = await t
      .caller("admin", 1, secondBranch!.id)
      .membership.findByPhone({ phone: member.phone });
    expect(searchFromSecondBranch[0]?.id).toBe(member.id);

    const { sale } = await t
      .caller("admin", 1, secondBranch!.id)
      .pos.createSale({
        memberId: member.id,
        items: [{ productId: branchProduct!.id, qty: 10 }],
        pointsToRedeem: 20,
      });

    expect(sale.branchId).toBe(secondBranch!.id);
    expect(sale.total).toBe(80);
    expect((await memberByCode("M0001")).points).toBe(member.points - 20);

    const [redeemTransaction] = await t.db
      .select()
      .from(pointTransactions)
      .where(
        and(
          eq(pointTransactions.saleId, sale.id),
          eq(pointTransactions.type, "redeem")
        )
      );
    expect(redeemTransaction).toMatchObject({
      branchId: secondBranch!.id,
      memberId: member.id,
      points: -20,
    });

    const historyFromMainBranch = await t
      .caller("admin", 1, 1)
      .membership.memberTransactions({ memberId: member.id });
    expect(historyFromMainBranch[0]).toMatchObject({
      branchId: secondBranch!.id,
      branchName: "สาขาทดสอบแต้มร่วม",
      points: -20,
    });
  });

  it("บัตรหมดอายุซื้อแบบสมาชิกหรือรับแต้มเพิ่มไม่ได้ และยอดเดิมถูกตัดเป็นศูนย์", async () => {
    const water = await productByCode("WATER");
    const [expiredMember] = await t.db
      .insert(members)
      .values({
        memberCode: "M-EXPIRED-SALE",
        name: "สมาชิกหมดอายุหน้าขาย",
        phone: "0800000199",
        points: 25,
        cardActivatedAt: new Date("2025-01-01T00:00:00.000Z"),
        cardExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();

    await expect(
      t.caller().pos.createSale({
        memberId: expiredMember!.id,
        items: [{ productId: water.id, qty: 10 }],
      })
    ).rejects.toThrow("บัตรสมาชิกหมดอายุแล้ว");

    expect((await memberByCode("M-EXPIRED-SALE")).points).toBe(0);
    const [expiry] = await t.db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.memberId, expiredMember!.id));
    expect(expiry).toMatchObject({ type: "expire", points: -25 });
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
      items: [{ productId: water.id, qty: 10 }], // 100 − 20 = 80 บาท → ยังไม่ได้แต้ม
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

describe("returnSale", () => {
  it("manager คืนสินค้าบางส่วนแล้วคืนสต๊อก ยอดเงิน และแต้มตามสัดส่วนบิลเดิม", async () => {
    await t.caller("admin").catalog.createProduct({
      code: "RETURN-PARTIAL-TEST",
      name: "สินค้าทดสอบการคืน",
      category: "other",
      unit: "ชิ้น",
      price: 200,
      cost: 100,
      stockQty: 10,
      lowStockAt: 1,
    });
    const product = await productByCode("RETURN-PARTIAL-TEST");
    const member = await memberByCode("M0001");
    const pointsBefore = member.points;
    const { sale, items } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: product.id, qty: 3 }],
      discount: 30,
      paymentMethod: "cash",
      received: 300,
    });
    expect(sale.total).toBe(570);
    expect(sale.pointsEarned).toBe(5);

    const firstReturn = await t.caller("manager").pos.returnSale({
      saleId: sale.id,
      items: [{ saleItemId: items[0]!.id, qty: 1 }],
      reason: "ลูกค้าซื้อสินค้าเกิน",
      refundMethod: "cash",
    });

    expect(firstReturn.sale.receiptNo).toMatch(/^RT\d{5}$/);
    expect(firstReturn.sale.transactionType).toBe("return");
    expect(firstReturn.sale.originalSaleId).toBe(sale.id);
    expect(firstReturn.sale.subtotal).toBe(-200);
    expect(firstReturn.sale.discount).toBe(-10);
    expect(firstReturn.sale.total).toBe(-190);
    expect(firstReturn.sale.vatAmount).toBe(-12.43);
    expect(firstReturn.sale.pointsEarned).toBe(-1);
    expect(firstReturn.items[0]!.qty).toBe(-1);
    expect(firstReturn.items[0]!.originalSaleItemId).toBe(items[0]!.id);
    expect((await productByCode("RETURN-PARTIAL-TEST")).stockQty).toBe(8);
    expect((await memberByCode("M0001")).points).toBe(
      pointsBefore + sale.pointsEarned - 1
    );

    const detail = await t.caller().pos.saleDetail({ id: sale.id });
    expect(detail.returnStatus).toBe("partial");
    expect(detail.returnedTotal).toBe(190);
    expect(detail.returnableItems[0]!.returnedQty).toBe(1);
    expect(detail.returnableItems[0]!.returnableQty).toBe(2);
    await expect(
      t.caller("manager").pos.updateSale({ id: sale.id, discount: 20 })
    ).rejects.toThrow("มีรายการคืนสินค้าแล้ว");
    await expect(
      t.caller("admin").pos.voidSale({ id: sale.id })
    ).rejects.toThrow("มีรายการคืนสินค้าแล้ว");
  });

  it("คืนหลายครั้งได้ไม่เกินจำนวนซื้อ และคืนครบแล้วปรับยอด/แต้มครบพอดี", async () => {
    await t.caller("admin").catalog.createProduct({
      code: "RETURN-LIMIT-TEST",
      name: "สินค้าทดสอบจำนวนคืน",
      category: "lubricant",
      unit: "ขวด",
      price: 75,
      cost: 40,
      stockQty: 6,
      lowStockAt: 1,
    });
    const product = await productByCode("RETURN-LIMIT-TEST");
    const stockBefore = product.stockQty;
    const member = await memberByCode("M0001");
    const pointsBefore = member.points;
    const { sale, items } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: product.id, qty: 2 }],
      pointsToRedeem: 10,
    });
    const itemId = items[0]!.id;

    await t.caller("manager").pos.returnSale({
      saleId: sale.id,
      items: [{ saleItemId: itemId, qty: 0.5 }],
      reason: "สินค้ามีตำหนิหนึ่งชิ้น",
      refundMethod: "cash",
    });
    await expect(
      t.caller("manager").pos.returnSale({
        saleId: sale.id,
        items: [{ saleItemId: itemId, qty: 2 }],
        reason: "พยายามคืนเกินจำนวน",
        refundMethod: "cash",
      })
    ).rejects.toThrow("เกินจำนวนที่เหลือ");

    await t.caller("manager").pos.returnSale({
      saleId: sale.id,
      items: [{ saleItemId: itemId, qty: 1.5 }],
      reason: "คืนสินค้าที่เหลือทั้งหมด",
      refundMethod: "cash",
    });

    const detail = await t.caller().pos.saleDetail({ id: sale.id });
    expect(detail.returnStatus).toBe("full");
    expect(detail.returnedTotal).toBe(sale.total);
    expect(detail.returnableItems[0]!.returnableQty).toBe(0);
    expect((await productByCode("RETURN-LIMIT-TEST")).stockQty).toBe(
      stockBefore
    );
    expect((await memberByCode("M0001")).points).toBe(pointsBefore);
  });

  it("cashier คืนสินค้าไม่ได้ และไม่รองรับการคืนน้ำมันเชื้อเพลิง", async () => {
    const water = await productByCode("WATER");
    const waterSale = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }],
    });
    await expect(
      t.caller("cashier").pos.returnSale({
        saleId: waterSale.sale.id,
        items: [{ saleItemId: waterSale.items[0]!.id, qty: 1 }],
        reason: "ลูกค้านำสินค้ามาคืน",
        refundMethod: "cash",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    const fuel = await productByCode("GSH95");
    const fuelSale = await t.caller().pos.createSale({
      items: [{ productId: fuel.id, qty: 1 }],
    });
    await expect(
      t.caller("manager").pos.returnSale({
        saleId: fuelSale.sale.id,
        items: [{ saleItemId: fuelSale.items[0]!.id, qty: 1 }],
        reason: "ทดสอบคืนน้ำมันเชื้อเพลิง",
        refundMethod: "cash",
      })
    ).rejects.toThrow("ไม่รองรับการคืนสินค้าประเภทน้ำมันเชื้อเพลิง");
  });

  it("admin ยกเลิกเอกสารคืนสินค้าแล้วหักสต๊อกและย้อนแต้มกลับ", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    const created = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 5 }],
    });
    const returned = await t.caller("manager").pos.returnSale({
      saleId: created.sale.id,
      items: [{ saleItemId: created.items[0]!.id, qty: 2 }],
      reason: "คืนเพื่อทดสอบการยกเลิก",
      refundMethod: "cash",
    });
    const stockAfterReturn = (await productByCode("WATER")).stockQty;
    const pointsAfterReturn = (await memberByCode("M0001")).points;

    await t.caller("admin").pos.voidSale({ id: returned.sale.id });

    expect((await productByCode("WATER")).stockQty).toBe(stockAfterReturn - 2);
    expect((await memberByCode("M0001")).points).toBe(
      pointsAfterReturn -
        returned.sale.pointsEarned +
        returned.sale.pointsRedeemed
    );
    const originalDetail = await t
      .caller()
      .pos.saleDetail({ id: created.sale.id });
    expect(originalDetail.returnedTotal).toBe(0);
  });
});

describe("updateSale", () => {
  it("ช่องทางที่ผู้ดูแลปิดไว้: สร้างบิลออนไลน์ไม่ได้ แต่บิลออฟไลน์ซิงก์ได้", async () => {
    const water = await productByCode("WATER");
    await t.db
      .insert(settings)
      .values({ branchId: 1, key: "pay_card_enabled", value: "0" })
      .onConflictDoUpdate({
        target: [settings.branchId, settings.key],
        set: { value: "0" },
      });
    try {
      await expect(
        t.caller().pos.createSale({
          items: [{ productId: water.id, qty: 1 }],
          paymentMethod: "card",
        })
      ).rejects.toThrow("ปิดใช้งาน");

      // บิลออฟไลน์ (มี clientReceiptNo) บันทึกได้ — รับเงินไปแล้วจริงที่หน้าร้าน
      const offline = await t.caller().pos.createSale({
        clientReceiptNo: "OFF-BCC123-20260722100000-0007",
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "card",
      });
      expect(offline.sale.paymentMethod).toBe("card");
    } finally {
      await t.db
        .delete(settings)
        .where(
          and(eq(settings.branchId, 1), eq(settings.key, "pay_card_enabled"))
        );
    }
  });

  it("แก้ส่วนลดแล้วคำนวณยอดสุทธิ/VAT/แต้มใหม่", async () => {
    const water = await productByCode("WATER");
    const member = await memberByCode("M0001");
    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: water.id, qty: 10 }], // 100 บาท → 1 แต้ม
    });
    const pointsAfterSale = (await memberByCode("M0001")).points;

    const updated = await t
      .caller("manager")
      .pos.updateSale({ id: sale.id, discount: 25 });

    expect(updated!.total).toBe(75);
    expect(updated!.vatAmount).toBe(4.91); // 75 × 7 / 107
    expect(updated!.pointsEarned).toBe(0); // ยอดสุทธิ 75 บาทยังไม่ครบ 100 บาท
    // แต้มปรับเฉพาะส่วนต่าง 1 → 0
    expect((await memberByCode("M0001")).points).toBe(pointsAfterSale - 1);
  });

  it("ระหว่างโปรโมชั่นแก้บิลเพื่อเพิ่มส่วนลดอื่นไม่ได้", async () => {
    const fuel = await productByCode("GSH95");
    await setPromotion(true);

    try {
      const { sale } = await t.caller().pos.createSale({
        items: [{ productId: fuel.id, qty: 10 }],
        paymentMethod: "qr",
      });
      expect(sale.discount).toBe(5);

      await expect(
        t
          .caller("manager")
          .pos.updateSale({ id: sale.id, discount: sale.discount + 1 })
      ).rejects.toThrow("ช่วงโปรโมชั่นไม่สามารถแก้ไขหรือเพิ่มส่วนลดอื่นได้");
    } finally {
      await setPromotion(false);
    }
  });

  it("แก้ไขบิลที่เลือกใช้แต้มแล้วจะไม่เพิ่มแต้มสะสมย้อนหลัง", async () => {
    const fuel = await productByCode("GSH95");
    const member = await memberByCode("M0001");
    const { sale } = await t.caller().pos.createSale({
      memberId: member.id,
      items: [{ productId: fuel.id, qty: 10 }],
      pointsToRedeem: 10,
      loyaltyChoice: "redeem",
    });
    const pointsAfterSale = (await memberByCode("M0001")).points;

    const updated = await t
      .caller("manager")
      .pos.updateSale({ id: sale.id, discount: 20 });

    expect(updated!.pointsRedeemed).toBe(10);
    expect(updated!.pointsEarned).toBe(0);
    expect((await memberByCode("M0001")).points).toBe(pointsAfterSale);
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

  it("แก้วิธีชำระเป็น QR ถุงเงินได้ ยอดรับเท่ายอดสุทธิและไม่มีเงินทอน", async () => {
    const water = await productByCode("WATER");
    const { sale } = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 2 }], // 20 บาท
      paymentMethod: "cash",
      received: 100,
    });

    const updated = await t
      .caller("manager")
      .pos.updateSale({ id: sale.id, paymentMethod: "thungngern" });

    expect(updated!.paymentMethod).toBe("thungngern");
    expect(updated!.received).toBe(20); // ไม่ใช่เงินสด → รับเท่ายอดสุทธิ
    expect(updated!.changeAmt).toBe(0);
  });
});

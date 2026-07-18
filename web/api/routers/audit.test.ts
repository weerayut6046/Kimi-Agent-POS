import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { auditLogs, members, priceChanges, products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสระบบ audit log + ประวัติเปลี่ยนราคา ผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed เหมือน production)
// seed staff: id 1 = admin "เจ้าของปั๊ม", id 2 = manager "สมหญิง (ผู้จัดการสาขา)", id 3 = somchai (cashier)
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const ADMIN = 1;
const MANAGER = 2;

const auditsOf = (action: string) =>
  t.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.id));

const productByCode = async (code: string) => {
  const p = await t.db.query.products.findFirst({ where: eq(products.code, code) });
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ใน seed`);
  return p;
};

describe("ประวัติเปลี่ยนราคา (updateProduct)", () => {
  it("เปลี่ยนราคาจริง → มี price_changes 1 แถว (old/new ถูก) + audit update_price พร้อม actorName", async () => {
    const water = await productByCode("WATER");
    await t.caller("admin", ADMIN).catalog.updateProduct({ id: water.id, price: 12.5 });

    const pcRows = await t.db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.productId, water.id))
      .orderBy(desc(priceChanges.id));
    expect(pcRows).toHaveLength(1);
    expect(pcRows[0]!.productCode).toBe("WATER");
    expect(pcRows[0]!.productName).toBe(water.name);
    expect(pcRows[0]!.oldPrice).toBe(10);
    expect(pcRows[0]!.newPrice).toBe(12.5);
    expect(pcRows[0]!.changedBy).toBe("เจ้าของปั๊ม");

    const logs = await auditsOf("update_price");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBe(ADMIN);
    expect(logs[0]!.actorName).toBe("เจ้าของปั๊ม");
    expect(logs[0]!.detail).toContain("WATER");
    expect(logs[0]!.detail).toContain("10.00");
    expect(logs[0]!.detail).toContain("12.50");
    expect(logs[0]!.refType).toBe("product");
    expect(logs[0]!.refId).toBe(water.id);

    // priceHistory คืนรายการที่เพิ่งบันทึก
    const history = await t.caller().catalog.priceHistory({ productId: water.id });
    expect(history).toHaveLength(1);
    expect(history[0]!.newPrice).toBe(12.5);
  });

  it("ส่งราคาเท่าเดิม / ไม่ได้เปลี่ยนราคา → ไม่มี price_changes เพิ่ม", async () => {
    const water = await productByCode("WATER");
    const beforeRows = await t.db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.productId, water.id));
    // ส่งราคาค่าเดิม (12.5 จากเทสก่อนหน้า) และแก้ชื่ออย่างเดียว
    await t.caller("admin", ADMIN).catalog.updateProduct({ id: water.id, price: 12.5 });
    await t.caller("admin", ADMIN).catalog.updateProduct({ id: water.id, lowStockAt: 30 });
    const afterRows = await t.db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.productId, water.id));
    expect(afterRows).toHaveLength(beforeRows.length);
  });
});

describe("audit log จาก mutation ต่างๆ", () => {
  it("voidSale → audit void_sale พร้อม refType sale", async () => {
    const water = await productByCode("WATER");
    const { sale } = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }],
      paymentMethod: "cash",
      received: 20,
    });
    await t.caller("admin", ADMIN).pos.voidSale({ id: sale.id });

    const logs = await auditsOf("void_sale");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorName).toBe("เจ้าของปั๊ม");
    expect(logs[0]!.detail).toContain(sale.receiptNo);
    expect(logs[0]!.refType).toBe("sale");
    expect(logs[0]!.refId).toBe(sale.id);
  });

  it("membership.adjustPoints → audit adjust_points", async () => {
    const m = await t.db.query.members.findFirst({ where: eq(members.memberCode, "M0001") });
    await t.caller("admin", ADMIN).membership.adjustPoints({
      memberId: m!.id,
      points: 50,
      note: "ทดสอบปรับแต้ม",
    });

    const logs = await auditsOf("adjust_points");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorName).toBe("เจ้าของปั๊ม");
    expect(logs[0]!.detail).toContain("M0001");
    expect(logs[0]!.detail).toContain("+50");
    expect(logs[0]!.detail).toContain("ทดสอบปรับแต้ม");
    expect(logs[0]!.refType).toBe("member");
    expect(logs[0]!.refId).toBe(m!.id);
  });

  it("credit.receivePayment → audit receive_debt_payment", async () => {
    const water = await productByCode("WATER");
    const cust = await t.caller("manager").customers.create({ name: "ลูกค้าทดสอบ audit", creditLimit: 0 });
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 4 }], // 12.5 × 4 = 50 บาท
      paymentMethod: "credit",
      customerId: cust!.id,
    });
    const payment = await t.caller("manager", MANAGER).credit.receivePayment({
      customerId: cust!.id,
      amount: 20,
      method: "cash",
    });

    const logs = await auditsOf("receive_debt_payment");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorName).toBe("สมหญิง (ผู้จัดการสาขา)");
    expect(logs[0]!.detail).toContain(payment!.paymentNo);
    expect(logs[0]!.detail).toContain("ลูกค้าทดสอบ audit");
    expect(logs[0]!.refType).toBe("debt_payment");
    expect(logs[0]!.refId).toBe(payment!.id);
  });
});

describe("audit.list (สิทธิ์ admin)", () => {
  it("cashier เรียก → reject สิทธิ์ไม่เพียงพอ", async () => {
    await expect(t.caller("cashier").audit.list()).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });

  it("admin เรียก → ได้รายการ + actions ครบ, filter action/q ทำงาน", async () => {
    const all = await t.caller("admin").audit.list();
    expect(all.rows.length).toBeGreaterThanOrEqual(4); // update_price, void_sale, adjust_points, receive_debt_payment
    expect(all.actions).toEqual(
      expect.arrayContaining(["update_price", "void_sale", "adjust_points", "receive_debt_payment"]),
    );

    const filtered = await t.caller("admin").audit.list({ action: "void_sale" });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]!.action).toBe("void_sale");

    const searched = await t.caller("admin").audit.list({ q: "ลูกค้าทดสอบ audit" });
    expect(searched.rows).toHaveLength(1);
    expect(searched.rows[0]!.action).toBe("receive_debt_payment");
  });
});

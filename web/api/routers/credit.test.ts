import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสระบบขายเชื่อ/ลูกค้าเครดิต ผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed เหมือน production)
// ยอดค้างของลูกค้า = Σ บิลเครดิต completed − Σ การชำระหนี้ (void บิล → หนี้ลดอัตโนมัติ)
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const productByCode = async (code: string) => {
  const p = await t.db.query.products.findFirst({ where: eq(products.code, code) });
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ใน seed`);
  return p;
};

let custSeq = 0;
const createCustomer = async (creditLimit = 0) => {
  custSeq += 1;
  const c = await t.caller("manager").customers.create({ name: `ลูกค้าเครดิตทดสอบ ${custSeq}`, creditLimit });
  if (!c) throw new Error("สร้างลูกค้าไม่สำเร็จ");
  return c;
};

const outstandingOf = async (customerId: number) => {
  const rows = await t.caller().credit.summary();
  return rows.find((r) => r.id === customerId)?.outstanding ?? 0;
};

describe("createSale ขายเชื่อ", () => {
  it("ขายเครดิตโดยไม่ส่ง customerId → error", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "credit",
      }),
    ).rejects.toThrow("ขายเชื่อต้องเลือกลูกค้า");
  });

  it("ขายเครดิตให้ลูกค้าที่ไม่มีจริง → error", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "credit",
        customerId: 99999,
      }),
    ).rejects.toThrow("ไม่พบลูกค้า");
  });

  it("ขายเครดิตสำเร็จ → received = total, ไม่มีเงินทอน, summary/detail แสดงยอดค้างถูก", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();

    const { sale } = await t.caller().pos.createSale({
      staffName: "ทดสอบ",
      items: [{ productId: water.id, qty: 4 }], // 40 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });

    expect(sale.customerId).toBe(cust.id);
    expect(sale.total).toBe(40);
    expect(sale.received).toBe(40); // เครดิต: received = total
    expect(sale.changeAmt).toBe(0);
    expect(sale.customerName).toBe(cust.name);

    // summary แสดงยอดค้าง
    expect(await outstandingOf(cust.id)).toBe(40);

    // detail แสดงบิลเครดิตค้าง ยังไม่มีการชำระ
    const detail = await t.caller().credit.detail({ customerId: cust.id });
    expect(detail.outstanding).toBe(40);
    expect(detail.creditSales).toHaveLength(1);
    expect(detail.creditSales[0]!.receiptNo).toBe(sale.receiptNo);
    expect(detail.payments).toHaveLength(0);
  });

  it("method อื่นไม่ผูกลูกค้าเครดิต (customerId ถูกเมินเป็น null)", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    const { sale } = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }],
      paymentMethod: "cash",
      received: 10,
      customerId: cust.id,
    });
    expect(sale.customerId).toBeNull();
    expect(await outstandingOf(cust.id)).toBe(0);
  });

  it("เกินวงเงินเครดิต → error", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer(50); // วงเงิน 50 บาท

    // บิลแรก 40 บาท ผ่าน
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 4 }],
      paymentMethod: "credit",
      customerId: cust.id,
    });
    // บิลสอง 20 บาท → ค้าง 40 + 20 = 60 เกินวงเงิน 50
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 2 }],
        paymentMethod: "credit",
        customerId: cust.id,
      }),
    ).rejects.toThrow("เกินวงเงินเครดิตของลูกค้า");
    expect(await outstandingOf(cust.id)).toBe(40);
  });

  it("void บิลเครดิต (admin) → ยอดค้างหาย", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    const { sale } = await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 3 }], // 30 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    expect(await outstandingOf(cust.id)).toBe(30);

    await t.caller("admin").pos.voidSale({ id: sale.id });
    expect(await outstandingOf(cust.id)).toBe(0);
  });
});

describe("รับชำระหนี้", () => {
  it("รับชำระบางส่วน → ยอดค้างลด และเลขที่ใบรับชำระขึ้นต้น P", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 4 }], // 40 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });

    const payment = await t.caller().credit.receivePayment({
      customerId: cust.id,
      amount: 15,
      method: "cash",
      staffName: "ผู้จัดการ",
    });

    expect(payment!.paymentNo).toMatch(/^P\d{5}$/);
    expect(payment!.amount).toBe(15);
    expect(await outstandingOf(cust.id)).toBe(25);

    const detail = await t.caller().credit.detail({ customerId: cust.id });
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]!.paymentNo).toBe(payment!.paymentNo);
  });

  it("รับชำระเกินยอดค้าง → error", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 2 }], // 20 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    await expect(
      t.caller().credit.receivePayment({ customerId: cust.id, amount: 20.01 }),
    ).rejects.toThrow("ยอดชำระมากกว่ายอดค้างชำระ");
    expect(await outstandingOf(cust.id)).toBe(20);
  });

  it("ลบการชำระ (manager) → ยอดค้างกลับมา", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 4 }], // 40 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    const payment = await t.caller().credit.receivePayment({ customerId: cust.id, amount: 40 });
    expect(await outstandingOf(cust.id)).toBe(0);

    await t.caller("manager").credit.removePayment({ id: payment!.id });
    expect(await outstandingOf(cust.id)).toBe(40);
  });

  it("cashier ลบการชำระ → error สิทธิ์ไม่เพียงพอ", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 2 }], // 20 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    const payment = await t.caller().credit.receivePayment({ customerId: cust.id, amount: 10 });
    await expect(t.caller("cashier").credit.removePayment({ id: payment!.id })).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ",
    );
    // รายการยังอยู่ ยอดค้างไม่เปลี่ยน
    expect(await outstandingOf(cust.id)).toBe(10);
  });
});

describe("ลบลูกค้า", () => {
  it("ลูกค้ามียอดค้างชำระ → ลบไม่ได้", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }], // 10 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    await expect(t.caller("manager").customers.remove({ id: cust.id })).rejects.toThrow(
      "ลบไม่ได้ ลูกค้ามียอดค้างชำระ",
    );
  });

  it("ลูกค้าไม่มียอดค้าง → ลบได้ปกติ", async () => {
    const cust = await createCustomer();
    await expect(t.caller("manager").customers.remove({ id: cust.id })).resolves.toEqual({ ok: true });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { branches, creditAccounts, products, sales } from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { creditDueOn } from "@contracts/credit";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสระบบขายเชื่อ/ลูกค้าเครดิต ผ่าน tRPC caller จริงลง SQLite ชั่วคราว (migrate + seed เหมือน production)
// ยอดค้างของลูกค้า = Σ บิลเครดิต completed − Σ การชำระหนี้ (void บิล → หนี้ลดอัตโนมัติ)
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

let custSeq = 0;
const createCustomer = async (creditLimit = 0, legacy = true) => {
  custSeq += 1;
  const c = await t
    .caller("manager")
    .customers.create({ name: `ลูกค้าเครดิตทดสอบ ${custSeq}`, creditLimit });
  if (!c) throw new Error("สร้างลูกค้าไม่สำเร็จ");
  if (legacy) {
    await t.db.insert(creditAccounts).values({
      branchId: 1, customerId: c.id, status: "legacy",
    });
  }
  return c;
};

const outstandingOf = async (customerId: number) => {
  const rows = await t.caller().credit.summary();
  return rows.find(r => r.id === customerId)?.outstanding ?? 0;
};

describe("createSale ขายเชื่อ", () => {
  it("ขายเครดิตโดยไม่ส่ง customerId → error", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "credit",
      })
    ).rejects.toThrow("ขายเชื่อต้องเลือกลูกค้า");
  });

  it("ขายเครดิตให้ลูกค้าที่ไม่มีจริง → error", async () => {
    const water = await productByCode("WATER");
    await expect(
      t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "credit",
        customerId: 99999,
      })
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
      })
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

    const payment = await t.caller("manager").credit.receivePayment({
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
      t
        .caller("manager")
        .credit.receivePayment({ customerId: cust.id, amount: 20.01 })
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
    const payment = await t
      .caller("manager")
      .credit.receivePayment({ customerId: cust.id, amount: 40 });
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
    const payment = await t
      .caller("manager")
      .credit.receivePayment({ customerId: cust.id, amount: 10 });
    await expect(
      t.caller("cashier").credit.removePayment({ id: payment!.id })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    // รายการยังอยู่ ยอดค้างไม่เปลี่ยน
    expect(await outstandingOf(cust.id)).toBe(10);
  });

  it("cashier รับชำระหนี้ → error สิทธิ์ไม่เพียงพอ", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 2 }], // 20 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    await expect(
      t
        .caller("cashier")
        .credit.receivePayment({ customerId: cust.id, amount: 10 })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    // ไม่มีรายการชำระเกิดขึ้น ยอดค้างคงเดิม
    expect(await outstandingOf(cust.id)).toBe(20);
  });
});

describe("รับชำระหนี้ผูกกะ (shift)", () => {
  it("มีกะเปิดอยู่ → การชำระผูก shiftId และนับเข้ายอดเงินสดควรมีของกะ", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 4 }], // 40 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });

    // เปิดกะด้วยเงินทอน 100
    const nz = (await t.db.query.nozzles.findMany()).sort(
      (a, b) => a.id - b.id
    );
    const { shiftId } = await t.caller().pos.openShift({
      staffName: "กะเครดิต",
      openingFloat: 100,
      readings: nz.map(n => ({
        nozzleId: n.id,
        openMeter: n.currentMeter,
        openMoney: n.currentMoney,
      })),
    });

    const payment = await t.caller("manager").credit.receivePayment({
      customerId: cust.id,
      amount: 40,
      method: "cash",
      staffName: "กะเครดิต",
    });
    expect(payment!.shiftId).toBe(shiftId);

    // ยอดเงินสดควรมีของกะรวมชำระหนี้เงินสดด้วย
    const cur = await t.caller().pos.currentShift();
    expect(cur!.cash.cashDebtPayments).toBe(40);
    expect(cur!.cash.expectedCash).toBe(140); // เงินทอน 100 + ชำระหนี้เงินสด 40

    // ปิดกะเก็บ (ไม่นับเงิน)
    await t.caller().pos.closeShift({
      shiftId,
      readings: nz.map(n => ({
        nozzleId: n.id,
        closeMeter: n.currentMeter,
        closeMoney: n.currentMoney,
      })),
    });
  });

  it("ไม่มีกะเปิดอยู่ → shiftId เป็น null", async () => {
    const water = await productByCode("WATER");
    const cust = await createCustomer();
    await t.caller().pos.createSale({
      items: [{ productId: water.id, qty: 1 }], // 10 บาท
      paymentMethod: "credit",
      customerId: cust.id,
    });
    const payment = await t
      .caller("manager")
      .credit.receivePayment({ customerId: cust.id, amount: 10 });
    expect(payment!.shiftId).toBeNull();
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
    await expect(
      t.caller("manager").customers.remove({ id: cust.id })
    ).rejects.toThrow("ลบไม่ได้ ลูกค้ามียอดค้างชำระ");
  });

  it("ลูกค้าไม่มียอดค้าง → ลบได้ปกติ", async () => {
    const cust = await createCustomer(0, false);
    await expect(
      t.caller("manager").customers.remove({ id: cust.id })
    ).resolves.toEqual({ ok: true });
  });
});

describe("บัญชีเครดิตที่ต้องอนุมัติ", () => {
  function terms(customerId: number, limit = 100) {
    return {
      customerId,
      verified: true as const,
      buyerType: "individual" as const,
      limit,
      days: 30,
      agreementRef: "FC03-001",
      signedOn: bangkokDateKey(new Date()),
      applicationRef: "FC01-001",
      identityRef: "แฟ้มผู้ซื้อ 001",
      receiversRef: "FC04-001",
      privacyNoticeRef: "FC12-001",
    };
  }

  it("requires manager approval, branch scope and a delivery reference", async () => {
    const customer = await createCustomer(0, false);
    const water = await productByCode("WATER");
    const order = {
      items: [{ productId: water.id, qty: 2 }],
      paymentMethod: "credit" as const,
      customerId: customer.id,
    };
    await expect(t.caller().pos.createSale(order)).rejects.toThrow("ยังไม่ได้รับอนุมัติ");
    await expect(t.caller().credit.approveAccount(terms(customer.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(t.caller("manager").credit.approveAccount({
      ...terms(customer.id), buyerType: "company",
    })).rejects.toThrow("อำนาจลงนาม");
    await t.caller("manager").credit.approveAccount(terms(customer.id));
    await expect(t.caller().pos.createSale(order)).rejects.toThrow("เลขอ้างอิงใบรับน้ำมัน");

    const [other] = await t.db.insert(branches).values({ code: "CREDIT-SCOPE", name: "สาขาทดสอบเครดิต" }).returning();
    await expect(t.caller("admin", 1, other!.id).credit.checkout({ customerId: customer.id })).resolves.toMatchObject({
      status: "unapproved", outstanding: 0,
    });
    const { sale } = await t.caller().pos.createSale({
      ...order,
      creditDeliveryRef: "FC05-001",
      clientReceiptNo: "OFF-CREDIT-20260101000000-0001",
      clientCreatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(sale.creditDueOn).toBe(creditDueOn(sale.createdAt, 30));
    expect(bangkokDateKey(sale.createdAt)).toBe(bangkokDateKey(new Date()));
    expect(sale.creditProof).toEqual({ agreementRef: "FC03-001", deliveryRef: "FC05-001" });
    await expect(t.caller().pos.createSale({
      ...order, creditDeliveryRef: "FC05-001",
    })).rejects.toThrow("ผูกกับบิล");
    await expect(t.caller("manager").pos.deleteSale({ id: sale.id })).rejects.toThrow("เก็บเป็นหลักฐาน");
    await expect(t.caller("manager").pos.updateSale({ id: sale.id, paymentMethod: "cash" })).rejects.toThrow("อนุมัติ");
    await expect(t.caller().credit.caseFile({ customerId: customer.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks overdue sales and preserves the allocation and reversal audit trail", async () => {
    const customer = await createCustomer(0, false);
    const water = await productByCode("WATER");
    const manager = t.caller("manager");
    await manager.credit.approveAccount(terms(customer.id));
    const order = {
      items: [{ productId: water.id, qty: 3 }],
      paymentMethod: "credit" as const,
      customerId: customer.id,
    };
    const first = await t.caller().pos.createSale({ ...order, creditDeliveryRef: "FC05-A" });
    const second = await t.caller().pos.createSale({ ...order, creditDeliveryRef: "FC05-B" });
    await t.db.update(sales).set({ creditDueOn: "2025-01-01" }).where(eq(sales.id, first.sale.id));
    await expect(t.caller().pos.createSale({
      ...order, creditDeliveryRef: "FC05-C",
    })).rejects.toThrow("เกินกำหนด");
    const requestId = "a1ea746a-0eb9-465b-b270-501385a59f2b";
    const payment = { customerId: customer.id, amount: 10, saleId: second.sale.id, requestId };
    const received = await manager.credit.receivePayment(payment);
    expect((await manager.credit.receivePayment(payment)).id).toBe(received.id);
    const detail = await manager.credit.detail({ customerId: customer.id });
    expect(detail.outstanding).toBe(50);
    expect(detail.overdue).toBe(30);
    expect(detail.invoices.find(bill => bill.id === second.sale.id)?.remaining).toBe(20);
    await expect(t.caller("admin").pos.voidSale({ id: second.sale.id, reason: "ตรวจสอบบิล" })).rejects.toThrow("มีเงินชำระแล้ว");
    await manager.credit.removePayment({ id: received.id, reason: "อ้างอิงรายการผิด" });
    await expect(manager.credit.receivePayment(payment)).rejects.toThrow("ถูกกลับรายการแล้ว");
    await manager.credit.recordFollowUp({
      customerId: customer.id, kind: "notice", occurredOn: bangkokDateKey(new Date()),
      reference: "FC17-001", notes: "บันทึกหลักฐานรับหนังสือ",
    });
    await manager.credit.recordFollowUp({
      customerId: customer.id, kind: "legal_review", reviewRoute: "civil",
      occurredOn: bangkokDateKey(new Date()), reference: "FC18-001",
      notes: "ตรวจยอดตามสัญญาและจัดเตรียมเอกสารเพื่อพิจารณาทางแพ่ง",
    });
    const file = await manager.credit.caseFile({ customerId: customer.id });
    expect(file.outstanding).toBe(60);
    expect(file.documents).toHaveLength(2);
    expect(file.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "payment_reversed", data: expect.objectContaining({ payment: expect.objectContaining({ id: received.id }) }) }),
      expect.objectContaining({ kind: "notice" }),
      expect.objectContaining({ kind: "legal_review", data: expect.objectContaining({ reviewRoute: "civil" }) }),
    ]));
    await manager.credit.suspendAccount({ customerId: customer.id, reason: "รอตรวจสอบเอกสาร" });
    await expect(t.caller().credit.checkout({ customerId: customer.id })).resolves.toMatchObject({ status: "suspended" });
  });

  it("serializes credit sales so two checkouts cannot both spend the same limit", async () => {
    const customer = await createCustomer(0, false);
    const water = await productByCode("WATER");
    await t.caller("manager").credit.approveAccount(terms(customer.id, 30));
    const results = await Promise.allSettled(["FC05-ONE", "FC05-TWO"].map(
      creditDeliveryRef => t.caller().pos.createSale({
        items: [{ productId: water.id, qty: 2 }],
        paymentMethod: "credit",
        customerId: customer.id,
        creditDeliveryRef,
      })
    ));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await outstandingOf(customer.id)).toBe(20);
  });
});

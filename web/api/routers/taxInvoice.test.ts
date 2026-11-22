import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;
beforeAll(async () => {
  test = await setupTestDb();
});
afterAll(() => test.cleanup());

it("attributes invoices to the original authenticated issuer", async () => {
  const product = await test.db.query.products.findFirst({
    where: and(eq(products.code, "WATER"), eq(products.branchId, 1)),
  });
  const cashier = test.caller("cashier");
  const { sale } = await cashier.pos.createSale({
    items: [{ productId: product!.id, qty: 1 }],
  });
  const invoice = await cashier.taxInvoice.save({
    saleId: sale.id,
    customerName: "ลูกค้าทดสอบ",
    issuedBy: "ชื่อที่ส่งจากไคลเอนต์",
  });
  expect(invoice?.issuedBy).toBe("สมชาย (พนักงาน)");

  const updated = await test.caller("manager").taxInvoice.save({
    saleId: sale.id,
    customerName: "ชื่อลูกค้าที่แก้ไข",
    issuedBy: "อีกชื่อที่ส่งจากไคลเอนต์",
  });
  expect(updated).toMatchObject({
    taxInvoiceNo: invoice?.taxInvoiceNo,
    customerName: "ชื่อลูกค้าที่แก้ไข",
    issuedBy: "สมชาย (พนักงาน)",
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { products, stockCountSessions } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("mobile stock counting", () => {
  it("creates a shared non-fuel count and lets cashier record quantities", async () => {
    const created = await t.caller("manager").stockCount.createSession({
      name: "นับสินค้าหน้าร้าน",
      scope: "all",
    });

    const session = await t
      .caller("cashier")
      .stockCount.getSession({ id: created.id });
    expect(session.status).toBe("counting");
    expect(session.items).toHaveLength(5);
    expect(session.items.map(item => item.category)).not.toContain("fuel");

    const first = session.items[0]!;
    await t.caller("cashier").stockCount.saveItemCount({
      sessionId: session.id,
      itemId: first.id,
      countedQty: first.expectedQty - 2,
      note: "พบขาด 2",
    });
    const refreshed = await t
      .caller("manager")
      .stockCount.getSession({ id: session.id });
    expect(refreshed.summary.countedItems).toBe(1);
    expect(refreshed.items[0]!.countedByName).toContain("สมชาย");
    expect(refreshed.items[0]!.difference).toBe(-2);

    await expect(
      t.caller("cashier").stockCount.completeSession({ id: session.id })
    ).rejects.toThrow("ผู้จัดการสาขา");

    for (const item of refreshed.items.slice(1)) {
      await t.caller("cashier").stockCount.saveItemCount({
        sessionId: session.id,
        itemId: item.id,
        countedQty: item.expectedQty,
      });
    }
    await t.caller("manager").stockCount.completeSession({ id: session.id });

    const completed = await t
      .caller("manager")
      .stockCount.getSession({ id: session.id });
    expect(completed.status).toBe("completed");
    expect(completed.summary.remainingItems).toBe(0);
    expect(completed.summary.varianceItems).toBe(1);

    const adjustedProduct = await t.db.query.products.findFirst({
      where: and(eq(products.id, first.productId!), eq(products.branchId, 1)),
    });
    expect(adjustedProduct!.stockQty).toBe(first.expectedQty - 2);
  });

  it("enforces one open count per branch and can cancel without changing stock", async () => {
    const before = await t.db.query.products.findFirst({
      where: and(eq(products.code, "WATER"), eq(products.branchId, 1)),
    });
    const created = await t.caller("manager").stockCount.createSession({
      name: "นับสินค้าในร้าน",
      scope: "other",
    });

    await expect(
      t.caller("admin").stockCount.createSession({
        name: "รอบซ้ำ",
        scope: "lubricant",
      })
    ).rejects.toThrow("กำลังดำเนินการอยู่");

    await t.caller("manager").stockCount.cancelSession({ id: created.id });
    const cancelled = await t.db.query.stockCountSessions.findFirst({
      where: eq(stockCountSessions.id, created.id),
    });
    expect(cancelled!.status).toBe("cancelled");

    const after = await t.db.query.products.findFirst({
      where: and(eq(products.code, "WATER"), eq(products.branchId, 1)),
    });
    expect(after!.stockQty).toBe(before!.stockQty);
  });

  it("does not expose a count session across branches", async () => {
    const created = await t.caller("manager").stockCount.createSession({
      name: "ทดสอบแยกสาขา",
      scope: "lubricant",
    });
    const branch = await t.caller("admin").auth.createBranch({
      code: "COUNT-BR2",
      name: "สาขานับสต๊อก 2",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });

    await expect(
      t
        .caller("admin", 1, branch.branch.id)
        .stockCount.getSession({ id: created.id })
    ).rejects.toThrow("ไม่พบรอบนับสต๊อกของสาขานี้");

    await t.caller("manager").stockCount.cancelSession({ id: created.id });
  });
});

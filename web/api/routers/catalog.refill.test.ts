import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { fuelTanks, products, tankRefills } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("catalog tank refills", () => {
  it("updates the linked fuel product cost from the received cost per liter", async () => {
    const product = await t.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "GSH95")),
    });
    expect(product).toBeDefined();

    const tank = await t.db.query.fuelTanks.findFirst({
      where: and(
        eq(fuelTanks.branchId, 1),
        eq(fuelTanks.productId, product!.id)
      ),
    });
    expect(tank).toBeDefined();

    const costPerLiter = 37.625;
    await t.caller("manager").catalog.refillTank({
      tankId: tank!.id,
      liters: 10,
      costPerLiter,
      note: "update product cost",
    });

    const [updatedProduct, updatedTank, refill] = await Promise.all([
      t.db.query.products.findFirst({
        where: and(eq(products.id, product!.id), eq(products.branchId, 1)),
      }),
      t.db.query.fuelTanks.findFirst({
        where: and(eq(fuelTanks.id, tank!.id), eq(fuelTanks.branchId, 1)),
      }),
      t.db.query.tankRefills.findFirst({
        where: and(
          eq(tankRefills.tankId, tank!.id),
          eq(tankRefills.branchId, 1)
        ),
      }),
    ]);

    expect(updatedProduct!.cost).toBe(costPerLiter);
    expect(updatedTank!.currentLiters).toBe(tank!.currentLiters + 10);
    expect(refill!.costPerLiter).toBe(costPerLiter);
  });
});

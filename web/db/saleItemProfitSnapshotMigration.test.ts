import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let pg: PGlite | undefined;

afterEach(async () => {
  await pg?.close();
  pg = undefined;
});

describe("Supabase sale item profit snapshot migration", () => {
  it("backfills cost/category and grants the built-in manager group", async () => {
    pg = new PGlite();
    await pg.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");

    const drizzleDir = fileURLToPath(
      new URL("./migrations-postgres/", import.meta.url)
    );
    const oldMigrations = fs
      .readdirSync(drizzleDir)
      .filter(file => file.endsWith(".sql") && file < "0029_")
      .sort();
    for (const migration of oldMigrations) {
      await pg.exec(fs.readFileSync(path.join(drizzleDir, migration), "utf8"));
    }

    await pg.exec(`
      insert into pos.products (code, name, category, unit, price, cost)
      values ('MIG-LUBE', 'น้ำมันเครื่อง migration', 'lubricant', 'ขวด', 100, 60);

      insert into pos.sales (receipt_no, subtotal, total)
      values ('MIG-001', 100, 100);

      insert into pos.sale_items (sale_id, product_id, name, qty, unit, unit_price, amount)
      select sale.id, product.id, product.name, 1, product.unit, product.price, product.price
      from pos.sales as sale
      cross join pos.products as product
      where sale.receipt_no = 'MIG-001' and product.code = 'MIG-LUBE';
    `);

    const supabaseMigration = fileURLToPath(
      new URL(
        "../../supabase/migrations/20260923002200_sale_item_profit_snapshots.sql",
        import.meta.url
      )
    );
    await pg.exec(fs.readFileSync(supabaseMigration, "utf8"));

    const item = await pg.query<{
      cost_per_unit: string;
      product_category: string;
    }>(`
      select cost_per_unit, product_category
      from pos.sale_items
      where name = 'น้ำมันเครื่อง migration'
    `);
    expect(Number(item.rows[0]?.cost_per_unit)).toBe(60);
    expect(item.rows[0]?.product_category).toBe("lubricant");

    const manager = await pg.query<{ menu_permissions: string[] }>(`
      select menu_permissions
      from pos.staff_access_groups
      where name = 'ผู้จัดการ'
    `);
    expect(manager.rows[0]?.menu_permissions).toContain("profitability");
  });
});

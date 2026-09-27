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

describe("Supabase shift reading cost snapshot migration", () => {
  it("adds and backfills the fuel cost captured by meter readings", async () => {
    pg = new PGlite();
    await pg.exec(
      "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
    );

    const drizzleDir = fileURLToPath(
      new URL("./migrations-postgres/", import.meta.url)
    );
    const oldMigrations = fs
      .readdirSync(drizzleDir)
      .filter(file => file.endsWith(".sql") && file < "0030_")
      .sort();
    for (const migration of oldMigrations) {
      await pg.exec(fs.readFileSync(path.join(drizzleDir, migration), "utf8"));
    }

    await pg.exec(`
      insert into pos.branches (code, name)
      values ('METER-COST', 'สาขาทดสอบต้นทุนมิเตอร์');

      insert into pos.products (branch_id, code, name, category, unit, price, cost)
      select id, 'METER-FUEL', 'น้ำมันทดสอบมิเตอร์', 'fuel', 'ลิตร', 40.50, 37.25
      from pos.branches where code = 'METER-COST';

      insert into pos.pumps (branch_id, name)
      select id, 'ตู้ทดสอบ' from pos.branches where code = 'METER-COST';

      insert into pos.nozzles (branch_id, pump_id, product_id, label)
      select branch.id, pump.id, product.id, 'หัวจ่ายทดสอบ'
      from pos.branches as branch
      join pos.pumps as pump on pump.branch_id = branch.id
      join pos.products as product on product.branch_id = branch.id
      where branch.code = 'METER-COST' and product.code = 'METER-FUEL';

      insert into pos.shifts (branch_id, staff_name, status, closed_at, total_liters, total_amount, total_money_meter)
      select id, 'ผู้ทดสอบ', 'closed', now(), 10, 405, 405
      from pos.branches where code = 'METER-COST';

      insert into pos.shift_readings (
        branch_id, shift_id, nozzle_id, open_meter, close_meter,
        open_money, close_money, price_per_liter
      )
      select branch.id, shift.id, nozzle.id, 100, 110, 4000, 4405, 40.50
      from pos.branches as branch
      join pos.shifts as shift on shift.branch_id = branch.id
      join pos.nozzles as nozzle on nozzle.branch_id = branch.id
      where branch.code = 'METER-COST';
    `);

    const migration = fileURLToPath(
      new URL(
        "../../supabase/migrations/20260923030401_shift_reading_cost_snapshots.sql",
        import.meta.url
      )
    );
    await pg.exec(fs.readFileSync(migration, "utf8"));

    const reading = await pg.query<{ cost_per_liter: string }>(`
      select cost_per_liter
      from pos.shift_readings
    `);
    expect(Number(reading.rows[0]?.cost_per_liter)).toBe(37.25);

    await pg.exec(`
      update pos.products set cost = 99 where code = 'METER-FUEL';
    `);
    const unchanged = await pg.query<{ cost_per_liter: string }>(`
      select cost_per_liter
      from pos.shift_readings
    `);
    expect(Number(unchanged.rows[0]?.cost_per_liter)).toBe(37.25);
  });
});

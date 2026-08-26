import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

let pg: PGlite | null = null;

afterEach(async () => {
  await pg?.close();
  pg = null;
});

describe("0022_set_loyalty_point_rates", () => {
  it("ปรับสาขาเดิมและเติมค่าที่หายให้เป็น 100 บาทต่อแต้ม / แต้มละ 1 บาท", async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE SCHEMA pos;
      CREATE TABLE pos.branches (id integer PRIMARY KEY);
      CREATE TABLE pos.settings (
        branch_id integer NOT NULL REFERENCES pos.branches(id),
        key text NOT NULL,
        value text NOT NULL,
        PRIMARY KEY (branch_id, key)
      );
      INSERT INTO pos.branches (id) VALUES (1), (2);
      INSERT INTO pos.settings (branch_id, key, value) VALUES
        (1, 'point_earn_per_baht', '25'),
        (1, 'point_redeem_value', '2');
    `);

    const migrationPath = fileURLToPath(
      new URL(
        "./migrations-postgres/0022_set_loyalty_point_rates.sql",
        import.meta.url
      )
    );
    await pg.exec(fs.readFileSync(migrationPath, "utf8"));

    const result = await pg.query<{
      branch_id: number;
      key: string;
      value: string;
    }>(`
      SELECT branch_id, key, value
      FROM pos.settings
      ORDER BY branch_id, key
    `);

    expect(result.rows).toEqual([
      { branch_id: 1, key: "point_earn_per_baht", value: "100" },
      { branch_id: 1, key: "point_redeem_value", value: "1" },
      { branch_id: 2, key: "point_earn_per_baht", value: "100" },
      { branch_id: 2, key: "point_redeem_value", value: "1" },
    ]);
  });
});

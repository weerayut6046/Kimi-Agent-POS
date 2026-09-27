import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let pg: PGlite | undefined;
afterEach(async () => {
  await pg?.close();
  pg = undefined;
});

describe("Supabase SaaS business registry migration", () => {
  it("preserves existing data, protects metadata, and enforces dedicated unique registrations", async () => {
    pg = new PGlite();
    await pg.exec(
      "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
    );
    const directory = fileURLToPath(
      new URL("./migrations-postgres/", import.meta.url)
    );
    for (const migration of fs
      .readdirSync(directory)
      .filter(file => file.endsWith(".sql") && file < "0033_")
      .sort()) {
      await pg.exec(fs.readFileSync(path.join(directory, migration), "utf8"));
    }
    await pg.exec(`
      insert into pos.staff_users (username, pin, name, role, menu_permissions)
      values ('existing-platform-admin', 'existing-hash', 'Existing Admin', 'admin', '["pos"]'::jsonb);
      insert into pos.products (code, name, category, unit, price, cost)
      values ('KEEP-PRODUCT', 'Existing product', 'other', 'piece', 100, 50);
    `);
    const before = await pg.query(
      "select username, pin, role, menu_permissions from pos.staff_users order by id"
    );
    const productBefore = await pg.query(
      "select code, price, cost from pos.products where code = 'KEEP-PRODUCT'"
    );
    const migration = fileURLToPath(
      new URL(
        "../../supabase/migrations/20260927083006_saas_business_registry.sql",
        import.meta.url
      )
    );
    await pg.exec(fs.readFileSync(migration, "utf8"));
    expect(
      (
        await pg.query(
          "select username, pin, role, menu_permissions from pos.staff_users order by id"
        )
      ).rows
    ).toEqual(before.rows);
    expect(
      (
        await pg.query(
          "select code, price, cost from pos.products where code = 'KEEP-PRODUCT'"
        )
      ).rows
    ).toEqual(productBefore.rows);
    const access = await pg.query(`
      select relrowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT') as anon_can_read,
        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read,
        has_table_privilege('anon', c.oid, 'INSERT') as anon_can_insert,
        has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_can_update
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pos' and c.relname = 'saas_businesses'
    `);
    expect(access.rows).toEqual([
      {
        relrowsecurity: true,
        anon_can_read: false,
        authenticated_can_read: false,
        anon_can_insert: false,
        authenticated_can_update: false,
      },
    ]);
    const insert = `insert into pos.saas_businesses (code, name, app_url, supabase_project_ref)
      values ('SHOP-ONE', 'Shop One', 'https://one.example.com', 'aaaaaaaaaaaaaaaaaaaa') returning id, status`;
    const created = await pg.query<{ id: string; status: string }>(insert);
    expect(created.rows[0]).toMatchObject({ status: "active" });
    expect(created.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(pg.query(insert)).rejects.toMatchObject({ code: "23505" });
    await expect(
      pg.exec("update pos.saas_businesses set status = 'deleted'")
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pg.exec("update pos.saas_businesses set supabase_project_ref = 'invalid'")
    ).rejects.toMatchObject({ code: "23514" });
  });
});

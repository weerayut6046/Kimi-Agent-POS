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

describe("Supabase passkey migration", () => {
  it("upgrades existing staff and creates private credentials with single-use challenges", async () => {
    pg = new PGlite();
    await pg.exec(
      "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
    );
    const drizzleDir = fileURLToPath(
      new URL("./migrations-postgres/", import.meta.url)
    );
    const oldMigrations = fs
      .readdirSync(drizzleDir)
      .filter(file => file.endsWith(".sql") && file < "0031_")
      .sort();
    for (const migration of oldMigrations) {
      await pg.exec(fs.readFileSync(path.join(drizzleDir, migration), "utf8"));
    }

    const existingStaff = await pg.query<{ id: number }>(`
      insert into pos.staff_users (username, pin, name, role, menu_permissions)
      values ('existing-staff', 'existing-pin-hash', 'Existing Staff', 'cashier', '["pos", "settings"]'::jsonb)
      returning id
    `);
    const existingStaffId = existingStaff.rows[0]?.id;
    const staffLookupSql = `
      select id, username, pin, name, role, menu_permissions, passkey_user_handle
      from pos.staff_users
      where username = 'existing-staff'
    `;
    // The deployed Drizzle staff lookup includes this new column even when
    // passkeys are disabled. An unapplied migration must reproduce 42703.
    await expect(pg.query(staffLookupSql)).rejects.toMatchObject({
      code: "42703",
    });

    const migration = fileURLToPath(
      new URL(
        "../../supabase/migrations/20260926001144_passkey_credentials.sql",
        import.meta.url
      )
    );
    await pg.exec(fs.readFileSync(migration, "utf8"));

    const upgradedStaff = await pg.query<{
      id: number;
      username: string;
      pin: string;
      name: string;
      role: string;
      menu_permissions: string[];
      passkey_user_handle: string | null;
    }>(staffLookupSql);
    expect(upgradedStaff.rows).toEqual([
      {
        id: existingStaffId,
        username: "existing-staff",
        pin: "existing-pin-hash",
        name: "Existing Staff",
        role: "cashier",
        menu_permissions: ["pos", "settings"],
        passkey_user_handle: null,
      },
    ]);

    const security = await pg.query<{
      relname: string;
      relrowsecurity: boolean;
      anon_can_read: boolean;
      authenticated_can_read: boolean;
    }>(`
      select c.relname, c.relrowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT') as anon_can_read,
        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pos'
        and c.relname in ('passkey_credentials', 'passkey_challenges')
      order by c.relname
    `);
    expect(security.rows).toEqual([
      {
        relname: "passkey_challenges",
        relrowsecurity: true,
        anon_can_read: false,
        authenticated_can_read: false,
      },
      {
        relname: "passkey_credentials",
        relrowsecurity: true,
        anon_can_read: false,
        authenticated_can_read: false,
      },
    ]);

    const staff = await pg.query<{ id: number }>(`
      insert into pos.staff_users (username, pin, name, passkey_user_handle)
      values ('passkey-test', 'hash', 'Test Staff', 'opaque-handle') returning id
    `);
    const staffId = staff.rows[0]?.id;
    expect(staffId).toBeTypeOf("number");
    await expect(
      pg.exec(`
      insert into pos.staff_users (username, pin, name, passkey_user_handle)
      values ('passkey-other', 'hash', 'Other Staff', 'opaque-handle')
    `)
    ).rejects.toThrow();
    await pg.exec(`
      insert into pos.passkey_credentials (id, staff_id, public_key, counter)
      values ('credential-id', ${staffId}, 'AQID', 7);
      insert into pos.passkey_challenges (id, purpose, challenge, staff_id, user_handle, expires_at)
      values ('11111111-1111-4111-8111-111111111111', 'registration', 'challenge', ${staffId}, 'opaque-handle', now() + interval '5 minutes');
    `);
    const credential = await pg.query<{ counter: string }>(`
      select counter from pos.passkey_credentials where id = 'credential-id'
    `);
    expect(Number(credential.rows[0]?.counter)).toBe(7);
    await expect(
      pg.exec(`
      insert into pos.passkey_challenges (id, purpose, challenge, expires_at)
      values ('22222222-2222-4222-8222-222222222222', 'registration', 'invalid', now() + interval '5 minutes')
    `)
    ).rejects.toThrow();
    const consumed = await pg.query<{ id: string }>(`
      update pos.passkey_challenges set consumed_at = now()
      where id = '11111111-1111-4111-8111-111111111111' and consumed_at is null
      returning id
    `);
    expect(consumed.rows).toHaveLength(1);
    const replay = await pg.query<{ id: string }>(`
      update pos.passkey_challenges set consumed_at = now()
      where id = '11111111-1111-4111-8111-111111111111' and consumed_at is null
      returning id
    `);
    expect(replay.rows).toHaveLength(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000001";
const CASHIER_AUTH_ID = "00000000-0000-0000-0000-000000000003";

let pg: PGlite;

async function canReceive(authUserId: string, topic: string) {
  await pg.exec(`set request.jwt.claim.sub = '${authUserId}'`);
  const result = await pg.query<{ allowed: boolean }>(
    "select pos.can_receive_realtime_broadcast($1) as allowed",
    [topic],
  );
  return result.rows[0]?.allowed ?? false;
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role pos_catalog_reader_live nologin;
    create schema auth;
    create schema pos;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table pos.branches (
      id integer primary key,
      active boolean not null
    );
    create table pos.staff_users (
      id integer primary key,
      role text not null,
      supabase_auth_user_id uuid unique,
      active boolean not null
    );
    create table pos.staff_branches (
      staff_id integer not null,
      branch_id integer not null,
      is_default boolean not null,
      primary key (staff_id, branch_id)
    );

    insert into pos.branches (id, active)
    values (1, true), (2, true), (3, false);

    insert into pos.staff_users (
      id,
      role,
      supabase_auth_user_id,
      active
    )
    values
      (1, 'admin', '${ADMIN_AUTH_ID}', true),
      (3, 'cashier', '${CASHIER_AUTH_ID}', true);

    insert into pos.staff_branches (staff_id, branch_id, is_default)
    values
      (3, 1, true),
      (3, 2, false),
      (3, 3, false);
  `);

  const migrationPath = fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260723093151_restrict_non_admin_realtime_to_default_branch.sql",
      import.meta.url,
    ),
  );
  await pg.exec(fs.readFileSync(path.resolve(migrationPath), "utf8"));
});

afterAll(async () => {
  await pg.close();
});

describe("Realtime branch authorization migration", () => {
  it("allows non-admin staff to receive only their default branch topic", async () => {
    await expect(
      canReceive(CASHIER_AUTH_ID, "pos-invalidation-v1:1"),
    ).resolves.toBe(true);
    await expect(
      canReceive(CASHIER_AUTH_ID, "pos-invalidation-v1:2"),
    ).resolves.toBe(false);
  });

  it("allows admins to receive every active branch topic", async () => {
    await expect(
      canReceive(ADMIN_AUTH_ID, "pos-invalidation-v1:1"),
    ).resolves.toBe(true);
    await expect(
      canReceive(ADMIN_AUTH_ID, "pos-invalidation-v1:2"),
    ).resolves.toBe(true);
    await expect(
      canReceive(ADMIN_AUTH_ID, "pos-invalidation-v1:3"),
    ).resolves.toBe(false);
  });
});

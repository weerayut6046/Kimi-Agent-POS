import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import { INITIAL_INSTALLATION_KEY } from "@contracts/initialSetup";
import { products, settings, staffUsers, shifts } from "@db/schema";
import { setupTestDb, type TestDb } from "../api/test/testDb";

let t: TestDb;
let env: Awaited<typeof import("../api/lib/env")>["env"];
let originalEnv: typeof env;
let seedIfEmpty: Awaited<typeof import("./seedCore")>["seedIfEmpty"];
let seedDevDemoData: Awaited<typeof import("./seedDevDemo")>["seedDevDemoData"];

beforeAll(async () => {
  t = await setupTestDb();
  ({ env } = await import("../api/lib/env"));
  originalEnv = { ...env };
  ({ seedIfEmpty } = await import("./seedCore"));
  ({ seedDevDemoData } = await import("./seedDevDemo"));
});
beforeEach(async () => {
  const result = await t.db.execute(
    sql`select tablename from pg_tables where schemaname = 'pos'`
  );
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Array<{ tablename: string }> }).rows;
  await t.db.execute(
    sql.raw(
      `truncate table ${rows.map(row => `pos."${row.tablename}"`).join(",")} restart identity cascade`
    )
  );
  Object.assign(env, originalEnv);
});
afterEach(() => {
  process.env.NODE_ENV = "test";
  Object.assign(env, originalEnv);
  vi.restoreAllMocks();
});
afterAll(() => t.cleanup());

describe("first-install factory seeding", () => {
  it("keeps the existing test accounts unchanged and creates no claim marker for fixtures", async () => {
    expect(await seedIfEmpty()).toBe(true);
    expect(
      (await t.db.select().from(staffUsers)).map(row => ({
        username: row.username,
        role: row.role,
        pin: row.pin,
      }))
    ).toEqual([
      {
        username: "admin",
        role: "admin",
        pin: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        username: "manager",
        role: "manager",
        pin: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        username: "somchai",
        role: "cashier",
        pin: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(
      (await t.db.select().from(settings)).find(
        row => row.key === INITIAL_INSTALLATION_KEY
      )
    ).toBeUndefined();
  });

  it("creates one pending owner in fresh local mode without relying on an inaccessible old password", async () => {
    process.env.NODE_ENV = "development";
    Object.assign(env, {
      localAuthEnabled: true,
      isProduction: false,
      localAdminPassword: "",
    });
    expect(await seedIfEmpty()).toBe(true);
    const owners = await t.db.select().from(staffUsers);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      username: "admin",
      role: "admin",
      name: "ผู้ดูแลระบบ",
      supabaseAuthUserId: null,
    });
    expect(owners[0].pin).toMatch(/^supabase-auth-pending:/);
    const marker = (await t.db.select().from(settings)).find(
      row => row.key === INITIAL_INSTALLATION_KEY
    );
    expect(JSON.parse(marker!.value)).toMatchObject({
      version: 1,
      status: "unclaimed",
      seedOwnerId: owners[0].id,
      pendingPinDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(marker!.value).not.toContain(owners[0].pin);
    expect(await seedDevDemoData({ explicit: true })).toEqual({
      skipped: true,
      daysCreated: 0,
      salesCreated: 0,
    });
    expect(await t.db.select().from(shifts)).toEqual([]);
    expect(await t.db.select().from(staffUsers)).toEqual(owners);
    expect(await seedIfEmpty()).toBe(false);
  });

  it("never upgrades an existing account or orphaned old data into an unclaimed installation", async () => {
    process.env.NODE_ENV = "development";
    await t.db
      .insert(staffUsers)
      .values({
        username: "old-admin",
        name: "Old Admin",
        pin: "old-password-hash",
        role: "admin",
      });
    const before = await t.db.select().from(staffUsers);
    expect(await seedIfEmpty()).toBe(false);
    expect(await t.db.select().from(staffUsers)).toEqual(before);
    expect(await t.db.select().from(settings)).toEqual([]);
    await t.db.delete(staffUsers);
    await t.db.execute(
      sql`insert into pos.branches(code,name) values ('MAIN','Main')`
    );
    await t.db
      .insert(products)
      .values({
        code: "OLD",
        name: "Old inventory",
        category: "other",
        unit: "piece",
        price: 20,
      });
    expect(await seedIfEmpty()).toBe(false);
    expect(await t.db.select().from(settings)).toEqual([]);
    expect(await t.db.select().from(staffUsers)).toEqual([]);
  });

  it("rolls back factory equipment and owner if marker creation fails", async () => {
    process.env.NODE_ENV = "development";
    await t.db.execute(
      sql`create function public.fail_factory_marker() returns trigger language plpgsql as $$ begin if new.key = 'business_installation_v1' then raise exception 'marker write failed'; end if; return new; end $$`
    );
    await t.db.execute(
      sql`create trigger fail_factory_marker before insert on pos.settings for each row execute function public.fail_factory_marker()`
    );
    try {
      await expect(seedIfEmpty()).rejects.toThrow();
      expect(await t.db.select().from(staffUsers)).toEqual([]);
      expect(await t.db.select().from(products)).toEqual([]);
    } finally {
      await t.db.execute(sql`drop trigger fail_factory_marker on pos.settings`);
      await t.db.execute(sql`drop function public.fail_factory_marker()`);
    }
    expect(await seedIfEmpty()).toBe(true);
  });

  it("skips automatic demo data on new claimed installs and preserves old accounts on explicit demo", async () => {
    process.env.NODE_ENV = "development";
    Object.assign(env, { localAuthEnabled: true, isProduction: false });
    await seedIfEmpty();
    await t.db.execute(
      sql`update pos.settings set value = '{"version":1,"status":"claimed"}' where key = 'business_installation_v1'`
    );
    expect((await seedDevDemoData()).skipped).toBe(true);
    await t.db
      .insert(staffUsers)
      .values({
        username: "devmanager",
        pin: "preserve-old-demo-password",
        name: "Existing Dev Manager",
        role: "manager",
      });
    const demo = await seedDevDemoData({ explicit: true });
    expect(demo.skipped).toBe(false);
    const staff = await t.db.select().from(staffUsers);
    expect(staff.find(row => row.username === "devmanager")?.pin).toBe(
      "preserve-old-demo-password"
    );
    const cashier = staff.find(row => row.username === "devcashier");
    expect(cashier?.pin).toMatch(/^staff-pin-hmac-v1:/);
    const { verifyStaffPin } = await import("../api/lib/staffPin");
    expect(await verifyStaffPin("2048", cashier!.pin)).toBe(true);
  });
});

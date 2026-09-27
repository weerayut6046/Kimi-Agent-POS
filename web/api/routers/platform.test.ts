import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import { saasBusinesses, branches, products, sales } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { normalizeBusinessAppUrl } from "../lib/platformRegistry";

let t: TestDb;
let sequence = 0;
const platformProjectRef = "p".repeat(20);

beforeAll(async () => {
  vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");
  vi.stubEnv("PUMPPOS_PROJECT_REF", platformProjectRef);
  t = await setupTestDb();
});
afterEach(() => {
  process.env.PUMPPOS_DEPLOYMENT_MODE = "platform";
});
afterAll(async () => {
  await t?.cleanup();
  vi.unstubAllEnvs();
});

function business(overrides: Record<string, unknown> = {}) {
  const number = ++sequence;
  return {
    code: `BUSINESS-${number}`,
    name: `Business ${number}`,
    appUrl: `https://business-${number}.example.com`,
    supabaseProjectRef: `${"a".repeat(18)}${number.toString(36).padStart(2, "0")}`,
    ...overrides,
  };
}

describe("SaaS platform registry", () => {
  it("registers only deployment metadata and preserves the existing POS database", async () => {
    const [before] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products);
    const [branchesBefore] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(branches);
    const [salesBefore] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sales);
    const input = business({
      code: "demo-shop",
      appUrl: "https://DEMO.example.com:443/",
    });
    const created = await t.caller("admin").platform.createBusiness(input);
    expect(created).toMatchObject({
      code: "DEMO-SHOP",
      appUrl: "https://demo.example.com",
      contactEmail: "",
      contactPhone: "",
      notes: "",
      status: "active",
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    const [after] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products);
    const [branchesAfter] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(branches);
    const [salesAfter] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sales);
    expect([after, branchesAfter, salesAfter]).toEqual([
      before,
      branchesBefore,
      salesBefore,
    ]);
  });

  it("supports searching, filtering, updates, and accurate registry totals", async () => {
    const created = await t
      .caller("admin")
      .platform.createBusiness(business({ name: "Alpha% Shop" }));
    const updated = await t.caller("admin").platform.updateBusiness({
      id: created.id,
      status: "paused",
      contactEmail: " owner@example.com ",
      contactPhone: " 0812345678 ",
      notes: "Metadata only",
    });
    expect(updated).toMatchObject({
      id: created.id,
      status: "paused",
      contactEmail: "owner@example.com",
      contactPhone: "0812345678",
      notes: "Metadata only",
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime()
    );
    const partialUpdate = await t.caller("admin").platform.updateBusiness({
      id: created.id,
      notes: "Still metadata only",
    });
    expect(partialUpdate).toMatchObject({
      status: "paused",
      contactEmail: "owner@example.com",
      contactPhone: "0812345678",
    });
    const found = await t
      .caller("admin")
      .platform.listBusinesses({ q: "%", status: "paused" });
    expect(found.map(row => row.id)).toEqual([created.id]);
    const rows = await t.db.select().from(saasBusinesses);
    const summary = await t.caller("admin").platform.overview();
    expect(summary).toEqual({
      total: rows.length,
      active: rows.filter(row => row.status === "active").length,
      paused: rows.filter(row => row.status === "paused").length,
      isolationModel: "dedicated-project",
    });
  });

  it.each(["cashier", "manager"] as const)(
    "denies all platform procedures to %s",
    async role => {
      const caller = t.caller(role).platform;
      await expect(caller.overview()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller.listBusinesses()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller.createBusiness(business())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.updateBusiness({
          id: "11111111-1111-4111-8111-111111111111",
          status: "paused",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("denies anonymous access and prevents business deployments from using the registry", async () => {
    await expect(t.anonymousCaller().platform.overview()).rejects.toMatchObject(
      { code: "UNAUTHORIZED" }
    );
    process.env.PUMPPOS_DEPLOYMENT_MODE = "business";
    const caller = t.caller("admin").platform;
    await expect(caller.overview()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.listBusinesses()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.createBusiness(business())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.updateBusiness({
        id: "11111111-1111-4111-8111-111111111111",
        status: "paused",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects the platform database project on both create and update", async () => {
    await expect(
      t
        .caller("admin")
        .platform.createBusiness(
          business({ supabaseProjectRef: platformProjectRef })
        )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const created = await t.caller("admin").platform.createBusiness(business());
    await expect(
      t.caller("admin").platform.updateBusiness({
        id: created.id,
        supabaseProjectRef: platformProjectRef,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("enforces unique normalized code, app origin, and Supabase project", async () => {
    const created = await t.caller("admin").platform.createBusiness(business());
    for (const override of [
      { code: created.code.toLowerCase() },
      { appUrl: `${created.appUrl}:443/` },
      { supabaseProjectRef: created.supabaseProjectRef },
    ]) {
      await expect(
        t.caller("admin").platform.createBusiness(business(override))
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    const other = await t.caller("admin").platform.createBusiness(business());
    await expect(
      t
        .caller("admin")
        .platform.updateBusiness({ id: other.id, appUrl: created.appUrl })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
    "https://example.com/admin",
    "http://example.com",
  ])("rejects an unsafe application link %s", async appUrl => {
    await expect(
      t.caller("admin").platform.createBusiness(business({ appUrl }))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects credential payload fields and invalid project references", async () => {
    await expect(
      t.caller("admin").platform.createBusiness({
        ...business(),
        databaseUrl: "postgresql://user:secret@example.com/db",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      t
        .caller("admin")
        .platform.createBusiness(
          business({ supabaseProjectRef: "not-a-project-ref" })
        )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      t
        .caller("admin")
        .platform.updateBusiness({ id: "11111111-1111-4111-8111-111111111111" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      t.caller("admin").platform.updateBusiness({
        id: "11111111-1111-4111-8111-111111111111",
        status: "paused",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("application origin validation", () => {
  it("permits localhost development and requires a public HTTPS origin in production", () => {
    expect(normalizeBusinessAppUrl("http://localhost:5173/", true)).toBe(
      "http://localhost:5173"
    );
    expect(normalizeBusinessAppUrl("https://EXAMPLE.com:443/", false)).toBe(
      "https://example.com"
    );
    expect(() =>
      normalizeBusinessAppUrl("http://localhost:5173", false)
    ).toThrow("Production");
    expect(() => normalizeBusinessAppUrl("https://localhost", false)).toThrow(
      "Production"
    );
  });
});

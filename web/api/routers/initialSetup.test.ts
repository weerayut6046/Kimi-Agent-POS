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
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { INITIAL_INSTALLATION_KEY } from "@contracts/initialSetup";
import {
  branches,
  employeeFaceProfiles,
  products,
  settings,
  shifts,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

const auth = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  issue: vi.fn(),
}));
vi.mock("../lib/supabaseAuth", async original => ({
  ...(await original<typeof import("../lib/supabaseAuth")>()),
  createSupabaseStaffIdentity: auth.create,
  deleteSupabaseStaffIdentity: auth.remove,
  issueSupabaseStaffSession: auth.issue,
}));
let t: TestDb;
let appRouter: Awaited<typeof import("../router")>["appRouter"];
let environment: Awaited<typeof import("../lib/env")>["env"];
let originalEnvironment: typeof environment;
let sequence = 0;
const CODE = "unit-test-installation-code-at-least-32-characters";
const AUTH_ID = "11111111-1111-4111-8111-111111111111";
const samples = Array.from({ length: 3 }, (_, sample) =>
  Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.17 + sample * 0.01) * 0.12
  )
);

beforeAll(async () => {
  vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "business");
  vi.stubEnv("ALLOWED_ORIGINS", "https://install.test");
  t = await setupTestDb();
  ({ appRouter } = await import("../router"));
  ({ env: environment } = await import("../lib/env"));
  originalEnvironment = { ...environment };
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
  Object.assign(environment, originalEnvironment, { installationCode: "" });
  process.env.PUMPPOS_DEPLOYMENT_MODE = "business";
  auth.create
    .mockReset()
    .mockResolvedValue({ id: AUTH_ID, email: "owner@staff.pumppos.invalid" });
  auth.remove.mockReset().mockResolvedValue(undefined);
  auth.issue.mockReset().mockResolvedValue({
    accessToken: "mock-access",
    refreshToken: "mock-refresh",
    expiresAt: 9999999999,
    faceProof: "mock-approved-proof",
  });
  const { clearActiveStaffCache } = await import("../lib/authorization");
  clearActiveStaffCache();
});
afterEach(() => {
  Object.assign(environment, originalEnvironment);
  process.env.NODE_ENV = "test";
  process.env.PUMPPOS_DEPLOYMENT_MODE = "business";
  vi.useRealTimers();
});
afterAll(async () => {
  await t?.cleanup();
  vi.unstubAllEnvs();
});

function api(headers: Record<string, string> = {}) {
  return appRouter.createCaller({
    req: new Request("https://install.test/api/trpc", {
      headers: {
        origin: "https://install.test",
        "x-forwarded-for": `test-${++sequence}`,
        ...headers,
      },
    }),
    resHeaders: new Headers(),
  }).initialSetup;
}
function input() {
  return {
    requestId: randomUUID(),
    name: "Business Owner",
    username: "owner",
    pin: "4729",
  };
}
function production() {
  Object.assign(environment, {
    isProduction: true,
    isTest: false,
    localAuthEnabled: false,
    installationCode: CODE,
    supabaseUrl: "https://unit-test.supabase.co",
    supabasePublishableKey: "unit-public",
    supabaseSecretKey: "unit-secret",
  });
}
async function factorySeed() {
  process.env.NODE_ENV = "development";
  const { seedIfEmpty } = await import("../../db/seedCore");
  expect(await seedIfEmpty()).toBe(true);
  process.env.NODE_ENV = "test";
}
async function installation() {
  return (
    await t.db
      .select()
      .from(settings)
      .where(eq(settings.key, INITIAL_INSTALLATION_KEY))
  )[0];
}

describe("first owner bootstrap", () => {
  it("recognizes a pristine database and creates one authenticated owner with full permissions", async () => {
    expect(await api().state()).toMatchObject({
      needsOwner: true,
      canCreateOwner: true,
      requiresInstallationCode: false,
      requiresFace: false,
      systemReady: true,
      databaseMode: "local",
      checks: [
        "database",
        "schema",
        "session",
        "staff_auth",
        "installation_code",
      ].map(key => ({ key, status: "ready" })),
    });
    const result = await api().createOwner(input());
    expect(result.staff).toMatchObject({
      role: "admin",
      username: "owner",
      branchCode: "MAIN",
      accessGroup: null,
    });
    expect(result.sessionToken).toMatch(/\./);
    expect(result.authSession).toBeUndefined();
    expect(result.staff.menuPermissions).toContain("setup");
    expect(result.staff.menuPermissions).toContain("platform");
    expect(await t.db.select().from(staffUsers)).toHaveLength(1);
    expect(await t.db.select().from(staffBranches)).toHaveLength(1);
    expect((await api().state()).needsOwner).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /4729|staff-pin-hmac|fingerprint|pendingPinDigest/
    );
    const { issueStaffSession } = await import("../lib/session");
    const signed = issueStaffSession({
      id: result.staff.id,
      name: result.staff.name,
      role: "admin",
      username: result.staff.username,
    });
    const state = await appRouter
      .createCaller({
        req: new Request("https://install.test/api", {
          headers: { "x-staff-session": signed },
        }),
        resHeaders: new Headers(),
      })
      .onboarding.state();
    expect(state.branch.id).toBe(result.staff.branchId);
  });

  it("updates only a newly marked exact factory owner and preserves seeded catalog/settings", async () => {
    await factorySeed();
    const [owner] = await t.db.select().from(staffUsers);
    const catalog = await t.db.select().from(products);
    const branchBefore = await t.db.select().from(branches);
    expect((await api().state()).needsOwner).toBe(true);
    await t.db.insert(settings).values({
      branchId: branchBefore[0].id,
      key: "preserved_setting",
      value: "untouched",
    });
    const result = await api().createOwner(input());
    expect(result.staff.id).toBe(owner.id);
    expect(await t.db.select().from(products)).toEqual(catalog);
    expect(await t.db.select().from(branches)).toEqual(branchBefore);
    expect(
      (
        await t.db
          .select()
          .from(settings)
          .where(eq(settings.key, "preserved_setting"))
      )[0].value
    ).toBe("untouched");
    expect(JSON.parse((await installation()).value)).toMatchObject({
      version: 1,
      status: "claimed",
      ownerId: owner.id,
    });
  });

  it.each(["legacy", "inactive", "changed-placeholder", "auth-identity"])(
    "keeps %s databases closed",
    async kind => {
      await factorySeed();
      const [owner] = await t.db.select().from(staffUsers);
      if (kind === "legacy")
        await t.db
          .delete(settings)
          .where(eq(settings.key, INITIAL_INSTALLATION_KEY));
      if (kind === "inactive")
        await t.db
          .update(staffUsers)
          .set({ active: false })
          .where(eq(staffUsers.id, owner.id));
      if (kind === "changed-placeholder")
        await t.db
          .update(staffUsers)
          .set({ pin: `supabase-auth-pending:${randomUUID()}` })
          .where(eq(staffUsers.id, owner.id));
      if (kind === "auth-identity")
        await t.db
          .update(staffUsers)
          .set({ supabaseAuthUserId: AUTH_ID })
          .where(eq(staffUsers.id, owner.id));
      const before = await t.db.select().from(staffUsers);
      expect((await api().state()).needsOwner).toBe(false);
      await expect(api().createOwner(input())).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await t.db.select().from(staffUsers)).toEqual(before);
    }
  );

  it("rejects factory owners with operational data and orphaned catalog data on a zero-staff database", async () => {
    await factorySeed();
    await t.db
      .insert(shifts)
      .values({ branchId: 1, staffId: 1, staffName: "Old operator" });
    expect((await api().state()).needsOwner).toBe(false);
    await expect(api().createOwner(input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await t.db.delete(shifts);
    await t.db.delete(staffUsers);
    await t.db
      .delete(settings)
      .where(eq(settings.key, INITIAL_INSTALLATION_KEY));
    expect((await api().state()).needsOwner).toBe(false);
    await expect(api().createOwner(input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("returns platform state without touching the database and forbids owner creation", async () => {
    process.env.PUMPPOS_DEPLOYMENT_MODE = "platform";
    const select = vi.spyOn(t.db, "select");
    expect(await api().state()).toEqual({
      needsOwner: false,
      canCreateOwner: false,
      requiresInstallationCode: false,
      requiresFace: false,
    });
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
    await expect(api().createOwner(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("requires configured production code and Auth settings, rejects foreign origins and rate limits guesses", async () => {
    production();
    environment.installationCode = "short";
    expect((await api().state()).canCreateOwner).toBe(false);
    await expect(api().createOwner(input())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    environment.installationCode = CODE;
    environment.supabaseSecretKey = "";
    expect((await api().state()).canCreateOwner).toBe(false);
    environment.supabaseSecretKey = "unit-secret";
    environment.supabaseUrl = "invalid-auth-url";
    expect((await api().state()).canCreateOwner).toBe(false);
    environment.supabaseUrl = "https://unit-test.supabase.co";
    environment.appSecret = "short";
    expect((await api().state()).canCreateOwner).toBe(false);
    environment.appSecret = originalEnvironment.appSecret;
    await expect(
      api({ origin: "https://other.test" }).createOwner({
        ...input(),
        installationCode: CODE,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      api({ referer: "https://other.test/setup" }).createOwner({
        ...input(),
        installationCode: CODE,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sameIp = api({ "x-forwarded-for": "rate-test" });
    for (let index = 0; index < 10; index++)
      await expect(sameIp.createOwner(input())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(sameIp.createOwner(input())).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(await t.db.select().from(staffUsers)).toEqual([]);
  });

  it.skip("requires valid face enrollment in production and emits a real-session shape without HMAC fallback", async () => {
    production();
    const claim = { ...input(), installationCode: CODE };
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      api().createOwner({ ...claim, embeddings: samples })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api().createOwner({
        ...claim,
        embeddings: [
          Array(128).fill(0),
          Array(128).fill(0),
          Array(128).fill(0),
        ],
        consentConfirmed: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const result = await api().createOwner({
      ...claim,
      embeddings: samples,
      consentConfirmed: true,
    });
    expect(result.sessionToken).toBeUndefined();
    expect(result.authSession).toMatchObject({
      accessToken: "mock-access",
      faceProof: "mock-approved-proof",
    });
    expect(auth.create).toHaveBeenCalledExactlyOnceWith({
      username: "owner",
      name: "Business Owner",
      role: "admin",
    });
    const [face] = await t.db.select().from(employeeFaceProfiles);
    expect(face).toMatchObject({
      model: "human-faceres-v1",
      embeddingCount: 3,
      embeddingDimensions: 128,
      enrolledByStaffId: result.staff.id,
    });
    expect(face.templateEncrypted).toMatch(/^v1\./);
    const { decryptFaceEmbeddings } = await import("../lib/faceBiometrics");
    expect(
      await decryptFaceEmbeddings(result.staff.id, face.templateEncrypted)
    ).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(
      /embeddings|templateEncrypted|4729|unit-secret/
    );
  });

  it("retries a lost response without duplicate owners and rejects changed, stale, or disabled-owner requests", async () => {
    const claim = input();
    const first = await api().createOwner(claim);
    expect((await api().createOwner(claim)).staff.id).toBe(first.staff.id);
    expect(await t.db.select().from(staffUsers)).toHaveLength(1);
    await expect(
      api().createOwner({ ...claim, pin: "6381" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      api().createOwner({ ...claim, requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const marker = JSON.parse((await installation()).value);
    await t.db
      .update(settings)
      .set({
        value: JSON.stringify({
          ...marker,
          claimedAt: new Date(Date.now() - 10 * 60_000 - 1).toISOString(),
        }),
      })
      .where(eq(settings.key, INITIAL_INSTALLATION_KEY));
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await t.db
      .update(settings)
      .set({ value: JSON.stringify(marker) })
      .where(eq(settings.key, INITIAL_INSTALLATION_KEY));
    await t.db
      .update(staffUsers)
      .set({ active: false })
      .where(eq(staffUsers.id, first.staff.id));
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("keeps a committed owner retryable after Supabase session mint fails", async () => {
    production();
    const claim = {
      ...input(),
      installationCode: CODE,
      embeddings: samples,
      consentConfirmed: true as const,
    };
    auth.issue.mockRejectedValueOnce(
      new Error("provider-sensitive-session-detail")
    );
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.not.stringContaining("provider-sensitive"),
    });
    expect(await t.db.select().from(staffUsers)).toHaveLength(1);
    const result = await api().createOwner(claim);
    expect(result.authSession?.accessToken).toBe("mock-access");
    expect(auth.create).toHaveBeenCalledTimes(1);
    expect(auth.remove).not.toHaveBeenCalled();
  });

  it.skip("denies committed retries after the owner's Auth identity or enrolled face is revoked", async () => {
    production();
    const claim = {
      ...input(),
      installationCode: CODE,
      embeddings: samples,
      consentConfirmed: true as const,
    };
    const first = await api().createOwner(claim);
    await t.db
      .update(staffUsers)
      .set({ supabaseAuthUserId: "22222222-2222-4222-8222-222222222222" })
      .where(eq(staffUsers.id, first.staff.id));
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await t.db
      .update(staffUsers)
      .set({ supabaseAuthUserId: AUTH_ID })
      .where(eq(staffUsers.id, first.staff.id));
    await t.db.delete(employeeFaceProfiles);
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(auth.issue).toHaveBeenCalledTimes(1);
  });

  it("rolls back SQL failures and compensates the newly created Auth identity", async () => {
    production();
    const claim = {
      ...input(),
      installationCode: CODE,
      embeddings: samples,
      consentConfirmed: true as const,
    };
    await t.db.execute(
      sql`create function public.fail_initial_owner_face() returns trigger language plpgsql as $$ begin raise exception 'sensitive-db-detail'; end $$`
    );
    await t.db.execute(
      sql`create trigger fail_initial_owner_face before insert on pos.employee_face_profiles for each row execute function public.fail_initial_owner_face()`
    );
    try {
      await expect(api().createOwner(claim)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: expect.not.stringContaining("sensitive-db-detail"),
      });
      expect(await t.db.select().from(staffUsers)).toEqual([]);
      expect(await installation()).toBeUndefined();
      expect(auth.remove).toHaveBeenCalledWith(AUTH_ID);
    } finally {
      await t.db.execute(
        sql`drop trigger fail_initial_owner_face on pos.employee_face_profiles`
      );
      await t.db.execute(sql`drop function public.fail_initial_owner_face()`);
    }
    expect((await api().createOwner(claim)).staff.role).toBe("admin");
  });

  it("leaves no owner or claim ledger when Auth creation fails and allows retry", async () => {
    production();
    const claim = {
      ...input(),
      installationCode: CODE,
      embeddings: samples,
      consentConfirmed: true as const,
    };
    auth.create.mockRejectedValueOnce(new Error("sensitive-provider-error"));
    await expect(api().createOwner(claim)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.not.stringContaining("sensitive-provider-error"),
    });
    expect(await t.db.select().from(staffUsers)).toEqual([]);
    expect(await installation()).toBeUndefined();
    expect((await api().createOwner(claim)).staff.username).toBe("owner");
  });

  it("serializes competing claims so only one owner wins", async () => {
    const first = input();
    const second = {
      ...input(),
      username: "second-owner",
      name: "Second Owner",
    };
    const results = await Promise.allSettled([
      api().createOwner(first),
      api().createOwner(second),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(
      1
    );
    expect(await t.db.select().from(staffUsers)).toHaveLength(1);
    expect(JSON.parse((await installation()).value).status).toBe("claimed");
  });

  it("reports missing and unreachable databases without exposing configuration or asserting a new installation", async () => {
    environment.databaseUrl = "";
    let state = await api().state();
    expect(state).toMatchObject({
      needsOwner: false,
      canCreateOwner: false,
      systemReady: false,
    });
    expect(state.checks).toContainEqual({ key: "database", status: "missing" });
    environment.databaseUrl = originalEnvironment.databaseUrl;
    const execute = vi
      .spyOn(t.db, "execute")
      .mockRejectedValueOnce(
        new Error("postgres://username:SECRET@private-host/db")
      );
    state = await api().state();
    execute.mockRestore();
    expect(state).toMatchObject({
      needsOwner: false,
      canCreateOwner: false,
      systemReady: false,
    });
    expect(state.checks).toContainEqual({
      key: "database",
      status: "unavailable",
    });
    expect(JSON.stringify(state)).not.toMatch(/SECRET|private-host|postgres/);
  });

  it("reports outdated schema and malformed SQL results as unavailable instead of treating them as pristine", async () => {
    const select = vi.spyOn(t.db, "select").mockImplementationOnce(() => {
      throw new Error("missing staff schema");
    });
    const state = await api().state();
    select.mockRestore();
    expect(state).toMatchObject({
      needsOwner: false,
      canCreateOwner: false,
      systemReady: false,
    });
    expect(state.checks).toContainEqual({ key: "database", status: "ready" });
    expect(state.checks).toContainEqual({
      key: "schema",
      status: "unavailable",
    });
    const { hasInitialSetupData } = await import("../lib/initialSetup");
    await expect(
      hasInitialSetupData({ execute: async () => ({ rows: [] }) } as never)
    ).rejects.toThrow("Unable to verify");
  });

  it("does not require an installation code for logging into an already configured production business", async () => {
    production();
    await api().createOwner({
      ...input(),
      installationCode: CODE,
      embeddings: samples,
      consentConfirmed: true,
    });
    environment.installationCode = "";
    const state = await api().state();
    expect(state).toMatchObject({
      needsOwner: false,
      canCreateOwner: false,
      systemReady: true,
    });
    expect(state.checks).toContainEqual({
      key: "installation_code",
      status: "missing",
    });
  });
});

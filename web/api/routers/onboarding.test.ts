import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  branches,
  employeeFaceProfiles,
  fuelTanks,
  nozzles,
  paymentSettings,
  products,
  pumps,
  settings,
  shifts,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { BUSINESS_SETUP_KEY } from "@contracts/onboarding";
import { setupTestDb, type TestDb } from "../test/testDb";
import type {
  setupStaffReadiness as StaffReadiness,
  setupPasskeysAvailable as PasskeysAvailable,
} from "../lib/onboarding";

let t: TestDb;
let setupStaffReadiness: typeof StaffReadiness;
let setupPasskeysAvailable: typeof PasskeysAvailable;
let sequence = 0;
const merchantQr =
  "00020101021130830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA53037645802TH62080704000063046EAD";

beforeAll(async () => {
  vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "business");
  t = await setupTestDb();
  ({ setupStaffReadiness, setupPasskeysAvailable } =
    await import("../lib/onboarding"));
});
afterEach(() => {
  process.env.PUMPPOS_DEPLOYMENT_MODE = "business";
});
afterAll(async () => {
  await t?.cleanup();
  vi.unstubAllEnvs();
});

async function newBranch() {
  const number = ++sequence;
  const [branch] = await t.db
    .insert(branches)
    .values({ code: `SETUP-${number}`, name: `Branch ${number}` })
    .returning();
  return branch.id;
}
function caller(branchId: number) {
  return t.caller("admin", 1, branchId).onboarding;
}
function profile(expectedBranchId: number) {
  return {
    expectedBranchId,
    shopName: "Owner's shop",
    branchName: "Configured branch",
    address: "123 Main Road",
    phone: "0812345678",
    taxId: "1234567890123",
  };
}
function cash(expectedBranchId: number) {
  return {
    expectedBranchId,
    cashEnabled: true,
    qrEnabled: false,
    cardEnabled: false,
    creditEnabled: false,
  };
}
function systemConfig(expectedBranchId: number) {
  return {
    expectedBranchId,
    receiptPaperSize: "58" as const,
    taxInvoicePaperSize: "a5" as const,
    silentPrint: false,
    vatRate: 0,
    pointEarnPerBaht: 200,
    pointRedeemValue: 2,
  };
}
function fuel(expectedBranchId: number, productId: number) {
  return {
    expectedBranchId,
    requestId: randomUUID(),
    productId,
    pumpName: "New pump",
    tankName: "New tank",
    nozzleLabel: "New nozzle",
    capacityLiters: 1000,
    currentLiters: 0,
    lowAlertAt: 100,
    meter: 123.456,
    money: 4567.89,
  };
}
async function product(branchId: number) {
  const [row] = await t.db
    .insert(products)
    .values({
      branchId,
      code: `SETUP-FUEL-${++sequence}`,
      name: "Diesel",
      category: "fuel",
      unit: "L",
      price: 30,
      cost: 25,
    })
    .returning();
  return row;
}
async function putSettings(branchId: number, entries: Record<string, string>) {
  await t.db
    .insert(settings)
    .values(
      Object.entries(entries).map(([key, value]) => ({ branchId, key, value }))
    )
    .onConflictDoUpdate({
      target: [settings.branchId, settings.key],
      set: { value: sql`excluded.value` },
    });
}
async function settingValues(branchId: number) {
  const rows = await t.db
    .select()
    .from(settings)
    .where(eq(settings.branchId, branchId));
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}
async function equipmentCounts(branchId: number) {
  const counts = await Promise.all([
    t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(fuelTanks)
      .where(eq(fuelTanks.branchId, branchId)),
    t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pumps)
      .where(eq(pumps.branchId, branchId)),
    t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(nozzles)
      .where(eq(nozzles.branchId, branchId)),
  ]);
  return counts.map(([row]) => row.count);
}

describe("business onboarding authorization and branch scope", () => {
  it.each(["cashier", "manager"] as const)(
    "denies every procedure to %s",
    async role => {
      const api = t.caller(role).onboarding;
      for (const operation of [
        () => api.state(),
        () => api.saveProfile(profile(1)),
        () => api.savePayments(cash(1)),
        () => api.saveSystemSettings(systemConfig(1)),
        () => api.confirmStep({ expectedBranchId: 1, step: "staff" }),
        () => api.complete({ expectedBranchId: 1 }),
        () => api.createFuelSetup(fuel(1, 1)),
        () =>
          api.updateEquipment({ expectedBranchId: 1, nozzleId: 1, meter: 0 }),
      ])
        await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("denies anonymous access and every setup procedure on platform deployments", async () => {
    await expect(t.anonymousCaller().onboarding.state()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    process.env.PUMPPOS_DEPLOYMENT_MODE = "platform";
    const api = caller(1);
    for (const operation of [
      () => api.state(),
      () => api.saveProfile(profile(1)),
      () => api.savePayments(cash(1)),
      () => api.saveSystemSettings(systemConfig(1)),
      () => api.confirmStep({ expectedBranchId: 1, step: "staff" }),
      () => api.complete({ expectedBranchId: 1 }),
      () => api.createFuelSetup(fuel(1, 1)),
      () => api.updateEquipment({ expectedBranchId: 1, nozzleId: 1, meter: 0 }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps seeded configuration unconfirmed and returns only the current branch", async () => {
    const seeded = await caller(1).state();
    expect(seeded.progress).toEqual({
      version: 1,
      confirmed: {
        profile: false,
        products: false,
        staff: false,
        payments: false,
        system: false,
      },
      completedAt: null,
    });
    await expect(
      caller(1).complete({ expectedBranchId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const branchId = await newBranch();
    const other = await newBranch();
    const ownProduct = await product(branchId);
    const otherProduct = await product(other);
    await caller(branchId).createFuelSetup(fuel(branchId, ownProduct.id));
    await caller(other).createFuelSetup(fuel(other, otherProduct.id));
    const state = await caller(branchId).state();
    expect(state.branch.id).toBe(branchId);
    expect(state.products.map(row => row.id)).toEqual([ownProduct.id]);
    expect(state.equipment).toHaveLength(1);
    expect(state.equipment[0].productId).toBe(ownProduct.id);
    expect(state.staff.map(row => row.id)).toEqual([1]);
    expect(state.profile.shopName).toBe("");
    await putSettings(branchId, {
      [BUSINESS_SETUP_KEY]: "legacy-invalid-json",
    });
    expect((await caller(branchId).state()).progress).toEqual(seeded.progress);
  });

  it("rejects stale branch forms before any mutation and never selects a branch from input", async () => {
    const oldBranch = await newBranch();
    const currentBranch = await newBranch();
    const p = await product(currentBranch);
    const api = caller(currentBranch);
    const before = await api.state();
    const oldBefore = await caller(oldBranch).state();
    for (const operation of [
      () => api.saveProfile(profile(oldBranch)),
      () => api.savePayments({ ...cash(oldBranch), promptpayId: "0812345678" }),
      () => api.confirmStep({ expectedBranchId: oldBranch, step: "staff" }),
      () => api.complete({ expectedBranchId: oldBranch }),
      () => api.createFuelSetup(fuel(oldBranch, p.id)),
      () =>
        api.updateEquipment({
          expectedBranchId: oldBranch,
          nozzleId: 1,
          meter: 0,
        }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await api.state()).toEqual(before);
    expect(await caller(oldBranch).state()).toEqual(oldBefore);
    expect(await settingValues(currentBranch)).toEqual({});
    expect(await equipmentCounts(currentBranch)).toEqual([0, 0, 0]);
    expect(
      await t.db
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.branchId, currentBranch))
    ).toEqual([]);
  });
});

describe("sparse profile and payment setup", () => {
  it("updates only the chosen branch fields and whitelisted settings, preserving secrets and counters", async () => {
    const branchId = await newBranch();
    const otherBranch = await newBranch();
    const untouched = {
      receipt_next_no: "823",
      tax_invoice_next_no: "742",
      theme: "dark",
      loyalty_points: "17",
      shop_logo: "logo-data",
      assistant_api_key: "stored-secret",
      arbitrary_setting: "keep",
    };
    await putSettings(branchId, untouched);
    await putSettings(otherBranch, { shop_name: "Other shop", ...untouched });
    await t.db.insert(paymentSettings).values({
      branchId,
      qrMode: "promptpay",
      promptpayId: "0898765432",
      thungngernEnabled: true,
      merchantPayload: "legacy-keep",
      provider: "slip2go",
      easyApiKeyEncrypted: "encrypted-api-secret",
      webhookTokenEncrypted: "encrypted-webhook-secret",
    });
    const [configBefore] = await t.db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.branchId, branchId));
    const api = caller(branchId);
    await api.saveProfile(profile(branchId));
    await api.savePayments(cash(branchId));
    await api.saveSystemSettings(systemConfig(branchId));
    expect(await settingValues(branchId)).toMatchObject({
      ...untouched,
      shop_name: "Owner's shop",
      shop_branch: "Configured branch",
      shop_address: "123 Main Road",
      shop_phone: "0812345678",
      tax_id: "1234567890123",
      pay_cash_enabled: "1",
      pay_qr_enabled: "0",
      pay_card_enabled: "0",
      pay_credit_enabled: "0",
    });
    expect(await settingValues(otherBranch)).toEqual({
      shop_name: "Other shop",
      ...untouched,
    });
    expect(
      await t.db
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.branchId, branchId))
    ).toEqual([configBefore]);
    const [branch] = await t.db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId));
    expect(branch).toMatchObject({
      code: expect.stringMatching(/^SETUP-/),
      name: "Configured branch",
      address: "123 Main Road",
      phone: "0812345678",
      taxId: "1234567890123",
      active: true,
    });
    const state = await api.state();
    expect(state.progress.confirmed).toMatchObject({
      profile: true,
      payments: true,
      products: false,
      staff: false,
    });
    expect(state.payments).toMatchObject({
      qrMode: "promptpay",
      thungngernEnabled: true,
      promptpayId: "0898765432",
    });
    expect(JSON.stringify(state)).not.toMatch(
      /encrypted-api-secret|encrypted-webhook-secret|stored-secret|legacy-keep/
    );
    await api.savePayments({
      ...cash(branchId),
      qrEnabled: true,
      promptpayId: "0812345678",
    });
    const [updated] = await t.db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.branchId, branchId));
    expect(updated).toMatchObject({
      ...configBefore,
      promptpayId: "0812345678",
      updatedAt: expect.any(Date),
    });
    expect((await api.state()).payments.qrReady).toBe(true);
  });

  it("preserves merchant mode and rejects receiver edits without overwriting payment flags", async () => {
    const branchId = await newBranch();
    await t.db.insert(paymentSettings).values({
      branchId,
      qrMode: "merchant",
      merchantPayload: merchantQr,
      promptpayId: "old-receiver",
      thungngernEnabled: true,
      easyApiKeyEncrypted: "keep-api",
      webhookTokenEncrypted: "keep-webhook",
    });
    const api = caller(branchId);
    await api.savePayments({ ...cash(branchId), qrEnabled: true });
    const before = await settingValues(branchId);
    const [config] = await t.db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.branchId, branchId));
    await expect(
      api.savePayments({ ...cash(branchId), promptpayId: "0812345678" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await settingValues(branchId)).toEqual(before);
    expect(
      await t.db
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.branchId, branchId))
    ).toEqual([config]);
    expect((await api.state()).payments).toMatchObject({
      qrMode: "merchant",
      qrReady: true,
      hasMerchantQr: true,
      thungngernEnabled: true,
    });
  });

  it("validates enabled QR and all-channel disable requests atomically", async () => {
    const branchId = await newBranch();
    const api = caller(branchId);
    await putSettings(branchId, {
      pay_cash_enabled: "1",
      pay_qr_enabled: "0",
      receipt_next_no: "51",
    });
    const before = await settingValues(branchId);
    await expect(
      api.savePayments({ ...cash(branchId), qrEnabled: true })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      api.savePayments({
        ...cash(branchId),
        qrEnabled: true,
        promptpayId: "invalid",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.savePayments({ ...cash(branchId), cashEnabled: false })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await settingValues(branchId)).toEqual(before);
    expect((await api.state()).progress.confirmed.payments).toBe(false);
    expect(
      await t.db
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.branchId, branchId))
    ).toEqual([]);
    await putSettings(branchId, { pay_qr_enabled: "1" });
    await expect(
      api.confirmStep({ expectedBranchId: branchId, step: "payments" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("natural readiness and confirmed completion", () => {
  it("saves only the reviewed system fields in the current branch and preserves secrets and document counters", async () => {
    const branchId = await newBranch();
    await putSettings(branchId, {
      receipt_next_no: "900",
      tax_invoice_next_no: "700",
      backup_auto_enabled: "1",
      private_service_token: "keep-private",
      app_theme: "ocean",
    });
    const api = caller(branchId);
    await expect(api.saveSystemSettings(systemConfig(1))).rejects.toMatchObject(
      { code: "CONFLICT" }
    );
    expect((await api.state()).progress.confirmed.system).toBe(false);
    await api.saveSystemSettings(systemConfig(branchId));
    expect(await settingValues(branchId)).toMatchObject({
      receipt_paper_size: "58",
      tax_invoice_paper_size: "a5",
      receipt_silent_print: "0",
      vat_rate: "0",
      point_earn_per_baht: "200",
      point_redeem_value: "2",
      receipt_next_no: "900",
      tax_invoice_next_no: "700",
      backup_auto_enabled: "1",
      private_service_token: "keep-private",
      app_theme: "ocean",
    });
    const state = await api.state();
    expect(state.systemSettings).toMatchObject({
      receiptPaperSize: "58",
      vatRate: 0,
      pointEarnPerBaht: 200,
    });
    expect(state.progress.confirmed.system).toBe(true);
    expect(JSON.stringify(state)).not.toContain("keep-private");
    await putSettings(branchId, { point_redeem_value: "NaN" });
    expect((await api.state()).readiness.system.ready).toBe(false);
    await expect(
      api.confirmStep({ expectedBranchId: branchId, step: "system" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      t.anonymousCaller().onboarding.saveSystemSettings(systemConfig(branchId))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("requires the actual fuel graph, rechecks readiness on complete, and keeps historical completion", async () => {
    const branchId = await newBranch();
    const api = caller(branchId);
    await expect(
      api.confirmStep({ expectedBranchId: branchId, step: "products" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const p = await product(branchId);
    await expect(
      api.confirmStep({ expectedBranchId: branchId, step: "products" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const created = await api.createFuelSetup(fuel(branchId, p.id));
    const ready = await api.state();
    expect(ready.readiness.products.ready).toBe(true);
    expect(ready.readiness.staff.ready).toBe(true);
    expect(ready.warnings).toContain(
      "New tank: ถังไม่มีน้ำมันคงเหลือ กรุณาตรวจสต๊อกก่อนขาย"
    );
    expect(ready.progress.confirmed.products).toBe(false);
    await api.saveProfile(profile(branchId));
    await api.savePayments(cash(branchId));
    await api.confirmStep({ expectedBranchId: branchId, step: "products" });
    await api.confirmStep({ expectedBranchId: branchId, step: "staff" });
    await api.saveSystemSettings(systemConfig(branchId));
    await t.db.update(products).set({ price: 0 }).where(eq(products.id, p.id));
    await expect(
      api.complete({ expectedBranchId: branchId })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await t.db.update(products).set({ price: 30 }).where(eq(products.id, p.id));
    await api.complete({ expectedBranchId: branchId });
    const completedAt = (await api.state()).progress.completedAt;
    expect(completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await api.complete({ expectedBranchId: branchId });
    expect((await api.state()).progress.completedAt).toBe(completedAt);
    await t.db
      .update(nozzles)
      .set({ currentMeter: 999 })
      .where(eq(nozzles.id, created.nozzleId));
    await t.db
      .update(products)
      .set({ active: false })
      .where(eq(products.id, p.id));
    expect((await api.state()).progress.completedAt).toBe(completedAt);
    expect((await api.state()).readiness.products.ready).toBe(false);
  });

  it("warns about pending staff while an authenticated owner can operate alone, without leaking identity secrets", async () => {
    const branchId = await newBranch();
    const [pending] = await t.db
      .insert(staffUsers)
      .values({
        username: `pending-${++sequence}`,
        name: "Pending cashier",
        role: "cashier",
        pin: "staff-pin-hmac-v1:bad",
        supabaseAuthUserId: "11111111-1111-4111-8111-111111111111",
      })
      .returning();
    await t.db.insert(staffBranches).values({ branchId, staffId: pending.id });
    await t.db.insert(employeeFaceProfiles).values({
      branchId,
      staffId: pending.id,
      templateEncrypted: "never-return-face-template",
      model: "old-face-model",
      embeddingCount: 3,
      embeddingDimensions: 128,
      consentAt: new Date(),
      enrolledByStaffId: 1,
    });
    const state = await caller(branchId).state();
    expect(state.staff.find(row => row.id === pending.id)).toMatchObject({
      pinReady: false,
      faceReady: false,
      loginReady: false,
    });
    expect(state.staff.find(row => row.id === 1)).toMatchObject({
      isCurrentUser: true,
      loginReady: true,
    });
    expect(state.readiness.staff.ready).toBe(true);
    expect(
      state.warnings.some(
        text =>
          text.includes("Pending cashier") &&
          text.includes("ยังไม่พร้อมเข้าสู่ระบบ")
      )
    ).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(
      /staff-pin-hmac|11111111-1111|never-return-face-template|embedding|supabaseAuthUserId|passkeyUserHandle/
    );
    await t.db
      .update(staffUsers)
      .set({ pin: "a".repeat(64) })
      .where(eq(staffUsers.id, pending.id));
    await t.db
      .update(employeeFaceProfiles)
      .set({ model: "human-faceres-v1" })
      .where(eq(employeeFaceProfiles.staffId, pending.id));
    expect(
      (await caller(branchId).state()).staff.find(row => row.id === pending.id)
    ).toMatchObject({ pinReady: true, faceReady: true, loginReady: true });
  });

  it("matches staff authentication requirements including exact PIN formats and passkey readiness", () => {
    const base = {
      pin: "a".repeat(64),
      active: true,
      currentOwner: false,
      hasAuthIdentity: false,
      hasCurrentFace: false,
      hasPasskey: false,
    };
    const production = {
      localSession: false,
      development: false,
      passkeysAvailable: false,
    };
    expect(setupStaffReadiness(base, production).loginReady).toBe(false);
    expect(
      setupStaffReadiness({ ...base, hasAuthIdentity: true }, production)
        .loginReady
    ).toBe(false);
    expect(
      setupStaffReadiness(
        { ...base, hasAuthIdentity: true, hasCurrentFace: true },
        production
      ).loginReady
    ).toBe(true);
    expect(
      setupStaffReadiness(base, { ...production, localSession: true })
        .loginReady
    ).toBe(false);
    expect(
      setupStaffReadiness(base, {
        ...production,
        localSession: true,
        development: true,
      }).loginReady
    ).toBe(true);
    expect(
      setupStaffReadiness({ ...base, currentOwner: true }, production)
        .loginReady
    ).toBe(true);
    expect(
      setupStaffReadiness(
        { ...base, currentOwner: true, active: false },
        production
      ).loginReady
    ).toBe(false);
    expect(
      setupStaffReadiness(
        {
          ...base,
          pin: "staff-pin-hmac-v1:bad",
          hasAuthIdentity: true,
          hasCurrentFace: true,
        },
        production
      ).loginReady
    ).toBe(false);
    expect(
      setupStaffReadiness(
        { ...base, pin: `staff-pin-hmac-v1:${"A".repeat(43)}` },
        production
      ).pinReady
    ).toBe(true);
    expect(
      setupStaffReadiness(
        { ...base, hasAuthIdentity: true, hasPasskey: true },
        { ...production, passkeysAvailable: true }
      ).loginReady
    ).toBe(true);
    expect(
      setupStaffReadiness(
        { ...base, hasPasskey: true },
        { ...production, passkeysAvailable: true }
      ).loginReady
    ).toBe(false);
    expect(
      setupStaffReadiness(
        { ...base, hasAuthIdentity: true, hasPasskey: true },
        production
      ).loginReady
    ).toBe(false);
  });

  it("makes passkey availability follow the configured RP and current browser origin", () => {
    const config = {
      rpId: "shop.example.com",
      origin: "https://shop.example.com",
    };
    const request = (headers: Record<string, string> = {}) =>
      new Request("http://api.internal/api", { headers });
    expect(setupPasskeysAvailable(request(), config)).toBe(true);
    expect(
      setupPasskeysAvailable(
        request({ origin: config.origin, referer: `${config.origin}/setup` }),
        config
      )
    ).toBe(true);
    expect(
      setupPasskeysAvailable(
        request({ origin: "http://localhost:5173" }),
        config
      )
    ).toBe(false);
    expect(
      setupPasskeysAvailable(
        request({ referer: "http://192.168.1.2/setup" }),
        config
      )
    ).toBe(false);
    expect(
      setupPasskeysAvailable(request({ referer: "malformed-url" }), config)
    ).toBe(false);
    expect(
      setupPasskeysAvailable(request(), {
        ...config,
        rpId: "elsewhere.example.com",
      })
    ).toBe(false);
    expect(
      setupPasskeysAvailable(request(), {
        rpId: "localhost",
        origin: "http://localhost:5173",
      })
    ).toBe(true);
    expect(
      setupPasskeysAvailable(request(), {
        rpId: "192.168.1.2",
        origin: "http://192.168.1.2",
      })
    ).toBe(false);
  });
});

describe("editing existing setup equipment", () => {
  it("corrects L/P and tank baselines to explicit zero without changing unsubmitted fields", async () => {
    const branchId = await newBranch();
    const p = await product(branchId);
    const api = caller(branchId);
    const created = await api.createFuelSetup({
      ...fuel(branchId, p.id),
      currentLiters: 750,
    });
    const [nozzleBefore] = await t.db
      .select()
      .from(nozzles)
      .where(eq(nozzles.id, created.nozzleId));
    const [tankBefore] = await t.db
      .select()
      .from(fuelTanks)
      .where(eq(fuelTanks.id, created.tankId));
    await api.updateEquipment({
      expectedBranchId: branchId,
      nozzleId: created.nozzleId,
      meter: 0,
      money: 0,
      currentLiters: 0,
      lowAlertAt: 0,
    });
    const [nozzleAfter] = await t.db
      .select()
      .from(nozzles)
      .where(eq(nozzles.id, created.nozzleId));
    const [tankAfter] = await t.db
      .select()
      .from(fuelTanks)
      .where(eq(fuelTanks.id, created.tankId));
    expect(nozzleAfter).toEqual({
      ...nozzleBefore,
      currentMeter: 0,
      currentMoney: 0,
    });
    expect(tankAfter).toEqual({
      ...tankBefore,
      currentLiters: 0,
      lowAlertAt: 0,
    });
    const state = await api.state();
    expect(state.equipment[0]).toMatchObject({
      meter: 0,
      money: 0,
      currentLiters: 0,
      lowAlertAt: 0,
      valid: true,
    });
    expect(state.progress.confirmed.products).toBe(false);
    expect(state.warnings.some(text => text.includes("ถังไม่มีน้ำมัน"))).toBe(
      true
    );
  });

  it("validates final tank values before writing any nozzle or tank patches", async () => {
    const branchId = await newBranch();
    const p = await product(branchId);
    const api = caller(branchId);
    const created = await api.createFuelSetup({
      ...fuel(branchId, p.id),
      currentLiters: 800,
    });
    const before = await api.state();
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: created.nozzleId,
        label: "must-rollback",
        meter: 0,
        tankName: "must-rollback",
        capacityLiters: 700,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await api.state()).toEqual(before);
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: created.nozzleId,
        lowAlertAt: 1001,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: created.nozzleId,
        meter: -1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: created.nozzleId,
        money: Infinity,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: created.nozzleId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await api.state()).toEqual(before);
    await api.updateEquipment({
      expectedBranchId: branchId,
      nozzleId: created.nozzleId,
      capacityLiters: 700,
      currentLiters: 0,
      lowAlertAt: 0,
    });
    expect((await api.state()).equipment[0]).toMatchObject({
      capacityLiters: 700,
      currentLiters: 0,
      lowAlertAt: 0,
    });
  });

  it("rejects editing another branch or any baseline while a shift is open", async () => {
    const branchId = await newBranch();
    const otherBranch = await newBranch();
    const p = await product(branchId);
    const otherP = await product(otherBranch);
    const own = await caller(branchId).createFuelSetup(fuel(branchId, p.id));
    const other = await caller(otherBranch).createFuelSetup(
      fuel(otherBranch, otherP.id)
    );
    const before = await caller(branchId).state();
    const otherBefore = await caller(otherBranch).state();
    await expect(
      caller(branchId).updateEquipment({
        expectedBranchId: branchId,
        nozzleId: other.nozzleId,
        meter: 0,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller(otherBranch).state()).toEqual(otherBefore);
    await t.db
      .insert(shifts)
      .values({ branchId, staffId: 1, staffName: "Owner" });
    await expect(
      caller(branchId).updateEquipment({
        expectedBranchId: branchId,
        nozzleId: own.nozzleId,
        meter: 0,
        currentLiters: 0,
        active: false,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await caller(branchId).state()).equipment).toEqual(
      before.equipment
    );
  });

  it("blocks inactive pump graphs and permits disabling a broken nozzle without a tank", async () => {
    const branchId = await newBranch();
    const p = await product(branchId);
    const api = caller(branchId);
    const valid = await api.createFuelSetup(fuel(branchId, p.id));
    const broken = await api.createFuelSetup(fuel(branchId, p.id));
    await t.db
      .update(pumps)
      .set({ active: false })
      .where(eq(pumps.id, broken.pumpId));
    expect(
      (await api.state()).equipment.find(row => row.id === broken.nozzleId)
        ?.valid
    ).toBe(false);
    expect((await api.state()).readiness.products.ready).toBe(false);
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: broken.nozzleId,
        meter: 0,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await t.db
      .update(nozzles)
      .set({ tankId: null })
      .where(eq(nozzles.id, broken.nozzleId));
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: broken.nozzleId,
        active: false,
        tankName: "missing",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await api.updateEquipment({
      expectedBranchId: branchId,
      nozzleId: broken.nozzleId,
      active: false,
    });
    expect((await api.state()).readiness.products.ready).toBe(true);
    expect(
      (await api.state()).equipment.find(row => row.id === valid.nozzleId)
        ?.active
    ).toBe(true);
    await expect(
      api.updateEquipment({
        expectedBranchId: branchId,
        nozzleId: broken.nozzleId,
        active: true,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("atomic and retry-safe fuel setup", () => {
  it("preserves existing equipment and returns the same result on a lost-response retry", async () => {
    const branchId = await newBranch();
    const p = await product(branchId);
    const api = caller(branchId);
    const first = await api.createFuelSetup(fuel(branchId, p.id));
    const input = fuel(branchId, p.id);
    const created = await api.createFuelSetup(input);
    expect(await equipmentCounts(branchId)).toEqual([2, 2, 2]);
    expect(created).not.toEqual(first);
    await t.db
      .insert(shifts)
      .values({ branchId, staffId: 1, staffName: "Owner" });
    expect(await api.createFuelSetup(input)).toEqual(created);
    expect(await equipmentCounts(branchId)).toEqual([2, 2, 2]);
    await expect(
      api.createFuelSetup({ ...input, meter: input.meter + 1 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await equipmentCounts(branchId)).toEqual([2, 2, 2]);
    const [nozzle] = await t.db
      .select()
      .from(nozzles)
      .where(eq(nozzles.id, created.nozzleId));
    expect(nozzle).toMatchObject({
      currentMeter: input.meter,
      currentMoney: input.money,
      tankId: created.tankId,
      pumpId: created.pumpId,
    });
  });

  it("rejects cross-branch products and open shifts without leaving a request marker", async () => {
    const branchId = await newBranch();
    const otherBranch = await newBranch();
    const otherProduct = await product(otherBranch);
    const api = caller(branchId);
    await expect(
      api.createFuelSetup(fuel(branchId, otherProduct.id))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const p = await product(branchId);
    await t.db
      .insert(shifts)
      .values({ branchId, staffId: 1, staffName: "Owner" });
    await expect(
      api.createFuelSetup(fuel(branchId, p.id))
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await settingValues(branchId)).toEqual({});
    expect(await equipmentCounts(branchId)).toEqual([0, 0, 0]);
  });

  it("rolls back tank, pump and marker if nozzle insertion fails, allowing an exact retry", async () => {
    const branchId = await newBranch();
    const p = await product(branchId);
    const input = { ...fuel(branchId, p.id), nozzleLabel: "FAIL-AT-NOZZLE" };
    await t.db.execute(
      sql`create function public.fail_setup_nozzle() returns trigger language plpgsql as $$ begin if new.label = 'FAIL-AT-NOZZLE' then raise exception 'simulated nozzle insert failure'; end if; return new; end $$`
    );
    await t.db.execute(
      sql`create trigger test_fail_setup_nozzle before insert on pos.nozzles for each row execute function public.fail_setup_nozzle()`
    );
    try {
      await expect(
        caller(branchId).createFuelSetup(input)
      ).rejects.toMatchObject({
        cause: { cause: { message: "simulated nozzle insert failure" } },
      });
      expect(await equipmentCounts(branchId)).toEqual([0, 0, 0]);
      expect(await settingValues(branchId)).toEqual({});
    } finally {
      await t.db.execute(
        sql`drop trigger test_fail_setup_nozzle on pos.nozzles`
      );
      await t.db.execute(sql`drop function public.fail_setup_nozzle()`);
    }
    const result = await caller(branchId).createFuelSetup(input);
    expect(result.nozzleId).toBeGreaterThan(0);
    expect(await equipmentCounts(branchId)).toEqual([1, 1, 1]);
    expect(
      (await settingValues(branchId))[`business_setup_fuel:${input.requestId}`]
    ).toContain(String(result.nozzleId));
  });
});

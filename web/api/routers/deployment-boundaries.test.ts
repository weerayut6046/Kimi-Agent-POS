import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => test.cleanup());

describe("dedicated deployment API boundaries", () => {
  it("retains all existing business administrator access by default", async () => {
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "business");
    const admin = test.caller("admin");
    expect(await admin.catalog.listProducts()).not.toHaveLength(0);
    expect(await admin.auth.listAllBranches()).not.toHaveLength(0);
    expect(await admin.auth.deploymentInfo()).toEqual({
      mode: "business",
      isolation: "dedicated_database",
    });
    await expect(admin.platform.overview()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("blocks business reads, writes and public loyalty in the platform", async () => {
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");
    const admin = test.caller("admin");
    const branchesBefore = await test.db.query.branches.findMany();
    await expect(admin.catalog.listProducts()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.auth.listStaffAccess()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      admin.auth.createBranch({
        code: "BLOCKED",
        name: "ไม่ควรถูกสร้าง",
        address: "",
        phone: "",
        taxId: "",
        cloneCurrentSetup: false,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.anonymousCaller().membership.customerPoints({
        phone: "0812345678",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await test.db.query.branches.findMany()).toEqual(branchesBefore);
  });

  it.each(["cashier", "manager"] as const)(
    "does not grant %s accounts platform administrator access",
    async role => {
      vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");
      await expect(test.caller(role).auth.currentStaff()).rejects.toMatchObject(
        { code: "FORBIDDEN" }
      );
      await expect(test.caller(role).platform.overview()).rejects.toMatchObject(
        { code: "FORBIDDEN" }
      );
    }
  );

  it("keeps deployment discovery public while requiring login for the registry", async () => {
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");
    expect(await test.anonymousCaller().auth.deploymentInfo()).toEqual({
      mode: "platform",
      isolation: "dedicated_database",
    });
    await expect(
      test.anonymousCaller().platform.overview()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

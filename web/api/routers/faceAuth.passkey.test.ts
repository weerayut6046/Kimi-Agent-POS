import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  passkeyChallenges,
  passkeyCredentials,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims: mocks.getClaims } }),
}));
vi.mock("@simplewebauthn/server", async importOriginal => ({
  ...(await importOriginal<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

const RP_ID = "test.local";
const ORIGIN = "https://test.local";
const CREDENTIAL_ID = "test-credential-123";
const registrationResponse = {
  id: CREDENTIAL_ID,
  rawId: CREDENTIAL_ID,
  type: "public-key" as const,
  response: { clientDataJSON: "dGVzdA", attestationObject: "dGVzdA" },
  clientExtensionResults: {},
};
const authenticationResponse = {
  id: CREDENTIAL_ID,
  rawId: CREDENTIAL_ID,
  type: "public-key" as const,
  response: {
    clientDataJSON: "dGVzdA",
    authenticatorData: "dGVzdA",
    signature: "dGVzdA",
    userHandle: null,
  },
  clientExtensionResults: {},
};

let test: TestDb;
let appRouter: Awaited<typeof import("../router")>["appRouter"];
const previousEnv = {
  rpId: process.env.PUMPPOS_PASSKEY_RP_ID,
  origin: process.env.PUMPPOS_PASSKEY_ORIGIN,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY,
};

function anonymousCaller(headers: Record<string, string> = {}) {
  return appRouter.createCaller({
    req: new Request("https://test.local/api", {
      headers: { origin: ORIGIN, ...headers },
    }),
    resHeaders: new Headers(),
  });
}

async function ensureCredential() {
  const exists = await test.db.query.passkeyCredentials.findFirst({
    where: eq(passkeyCredentials.id, CREDENTIAL_ID),
  });
  if (exists) return;
  const begin = await test
    .caller("cashier", 3)
    .faceAuth.beginPasskeyRegistration();
  await test.caller("cashier", 3).faceAuth.completePasskeyRegistration({
    challengeId: begin.challengeId,
    response: registrationResponse,
  });
}

beforeAll(async () => {
  process.env.PUMPPOS_PASSKEY_RP_ID = RP_ID;
  process.env.PUMPPOS_PASSKEY_ORIGIN = ORIGIN;
  process.env.SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "unit-test-key";
  test = await setupTestDb();
  ({ appRouter } = await import("../router"));
});

afterAll(() => {
  test.cleanup();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("PUMPPOS_PASSKEY_RP_ID", previousEnv.rpId);
  restore("PUMPPOS_PASSKEY_ORIGIN", previousEnv.origin);
  restore("SUPABASE_URL", previousEnv.supabaseUrl);
  restore("SUPABASE_PUBLISHABLE_KEY", previousEnv.supabaseKey);
});

beforeEach(() => {
  mocks.getClaims.mockReset();
  mocks.verifyRegistrationResponse.mockReset();
  mocks.verifyAuthenticationResponse.mockReset();
  mocks.verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      userVerified: true,
      credential: {
        id: CREDENTIAL_ID,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
    },
  });
  mocks.verifyAuthenticationResponse.mockResolvedValue({
    verified: true,
    authenticationInfo: { userVerified: true, newCounter: 1 },
  });
});

describe("app-owned WebAuthn passkey login", () => {
  it("offers passkeys only at the configured origin", async () => {
    expect(await anonymousCaller().faceAuth.passkeyStatus()).toEqual({
      available: true,
    });
    expect(
      await anonymousCaller({
        origin: "https://other.local",
      }).faceAuth.passkeyStatus()
    ).toEqual({ available: false });
    await expect(
      anonymousCaller({
        origin: "https://other.local",
      }).faceAuth.beginPasskeyLogin()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("requires a signed POS session and settings permission to enroll", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "11111111-1111-4111-8111-111111111111",
          session_id: "22222222-2222-4222-8222-222222222222",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    await expect(
      anonymousCaller({
        authorization: "Bearer valid-password-session",
      }).faceAuth.beginPasskeyRegistration()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getClaims).toHaveBeenCalled();
    await test.db
      .update(staffUsers)
      .set({ menuPermissions: ["pos"] })
      .where(eq(staffUsers.id, 3));
    try {
      await expect(
        test.caller("cashier", 3).faceAuth.beginPasskeyRegistration()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await test.db
        .update(staffUsers)
        .set({ menuPermissions: null })
        .where(eq(staffUsers.id, 3));
    }
  });

  it("registers an opaque user handle with discoverable platform verification", async () => {
    const begin = await test
      .caller("cashier", 3)
      .faceAuth.beginPasskeyRegistration();
    expect(begin.options.authenticatorSelection).toEqual(
      expect.objectContaining({
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      })
    );
    const staff = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, 3),
    });
    expect(staff?.passkeyUserHandle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(begin.options.user.id).toBe(staff?.passkeyUserHandle);
    const completed = await test
      .caller("cashier", 3)
      .faceAuth.completePasskeyRegistration({
        challengeId: begin.challengeId,
        response: registrationResponse,
      });
    expect(completed).toEqual({ ok: true, credentialId: CREDENTIAL_ID });
    expect(mocks.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: begin.options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      })
    );
    expect(
      await test.db.query.passkeyCredentials.findFirst({
        where: eq(passkeyCredentials.id, CREDENTIAL_ID),
      })
    ).toMatchObject({ staffId: 3, publicKey: "AQID", counter: 0 });
  });

  it("consumes invalid enrollment challenges and requires user verification", async () => {
    const begin = await test
      .caller("cashier", 3)
      .faceAuth.beginPasskeyRegistration();
    await expect(
      test.caller("cashier", 3).faceAuth.completePasskeyRegistration({
        challengeId: begin.challengeId,
        response: {},
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      test.caller("cashier", 3).faceAuth.completePasskeyRegistration({
        challengeId: begin.challengeId,
        response: registrationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const second = await test
      .caller("cashier", 3)
      .faceAuth.beginPasskeyRegistration();
    mocks.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        userVerified: false,
        credential: {
          id: "unverified",
          publicKey: new Uint8Array([1]),
          counter: 0,
        },
      },
    });
    await expect(
      test.caller("cashier", 3).faceAuth.completePasskeyRegistration({
        challengeId: second.challengeId,
        response: registrationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("uses username-free options and issues the existing staff session after verification", async () => {
    await ensureCredential();
    const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
    expect(begin.options.allowCredentials).toEqual([]);
    expect(begin.options.userVerification).toBe("required");
    const result = await anonymousCaller().faceAuth.completePasskeyLogin({
      challengeId: begin.challengeId,
      response: authenticationResponse,
    });
    expect(result.staff.id).toBe(3);
    expect(result.staff.branchId).toBe(1);
    expect(result.staff.sessionToken).toMatch(/\./);
    expect(result.authSession).toBeNull();
    expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: begin.options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      })
    );
    expect(
      (
        await test.db.query.passkeyCredentials.findFirst({
          where: eq(passkeyCredentials.id, CREDENTIAL_ID),
        })
      )?.counter
    ).toBe(1);
  });

  it("consumes malformed assertions and denies replay", async () => {
    await ensureCredential();
    const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: {},
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: authenticationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const consumed = await test.db.query.passkeyChallenges.findFirst({
      where: eq(passkeyChallenges.id, begin.challengeId),
    });
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
  });

  it("does not let a registration challenge authenticate", async () => {
    const begin = await test
      .caller("cashier", 3)
      .faceAuth.beginPasskeyRegistration();
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: authenticationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const challenge = await test.db.query.passkeyChallenges.findFirst({
      where: eq(passkeyChallenges.id, begin.challengeId),
    });
    expect(challenge?.purpose).toBe("registration");
    expect(challenge?.consumedAt).toBeNull();
  });

  it("rejects an invalid signature and consumes its challenge", async () => {
    await ensureCredential();
    const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
    mocks.verifyAuthenticationResponse.mockRejectedValueOnce(
      new Error("invalid signature")
    );
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: authenticationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: authenticationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("denies login without user verification", async () => {
    await ensureCredential();
    const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
    mocks.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { userVerified: false, newCounter: 2 },
    });
    await expect(
      anonymousCaller().faceAuth.completePasskeyLogin({
        challengeId: begin.challengeId,
        response: authenticationResponse,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects inactive staff and unassigned staff, including administrators", async () => {
    await ensureCredential();
    await test.db
      .update(staffUsers)
      .set({ active: false })
      .where(eq(staffUsers.id, 3));
    try {
      const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
      await expect(
        anonymousCaller().faceAuth.completePasskeyLogin({
          challengeId: begin.challengeId,
          response: authenticationResponse,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await test.db
        .update(staffUsers)
        .set({ active: true })
        .where(eq(staffUsers.id, 3));
    }
    const assignments = await test.db
      .select()
      .from(staffBranches)
      .where(eq(staffBranches.staffId, 3));
    await test.db.delete(staffBranches).where(eq(staffBranches.staffId, 3));
    try {
      const begin = await anonymousCaller().faceAuth.beginPasskeyLogin();
      await expect(
        anonymousCaller().faceAuth.completePasskeyLogin({
          challengeId: begin.challengeId,
          response: authenticationResponse,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await test.db
        .update(staffUsers)
        .set({ role: "admin" })
        .where(eq(staffUsers.id, 3));
      const adminBegin = await anonymousCaller().faceAuth.beginPasskeyLogin();
      await expect(
        anonymousCaller().faceAuth.completePasskeyLogin({
          challengeId: adminBegin.challengeId,
          response: authenticationResponse,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await test.db
        .update(staffUsers)
        .set({ role: "cashier" })
        .where(eq(staffUsers.id, 3));
      await test.db.insert(staffBranches).values(assignments);
    }
  });

  it("limits challenge creation across server instances through the database", async () => {
    const headers = { "x-forwarded-for": "203.0.113.44" };
    for (let i = 0; i < 10; i += 1) {
      await anonymousCaller(headers).faceAuth.beginPasskeyLogin();
    }
    await expect(
      anonymousCaller(headers).faceAuth.beginPasskeyLogin()
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

import { TRPCError } from "@trpc/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { and, asc, desc, eq, gt, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  branches,
  loginAttempts,
  passkeyChallenges,
  passkeyCredentials,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { anonymousQuery, createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { clientIpFromReq } from "../lib/clientIp";
import { env, isDevelopmentRuntime } from "../lib/env";
import {
  hashStaffPin,
  isLegacyStaffPinHash,
  verifyLegacyStaffPin,
  verifyStaffPin,
} from "../lib/staffPin";
import { issueStaffSession } from "../lib/session";
import { issueSupabaseStaffSession } from "../lib/supabaseAuth";
import { staffSessionResponse } from "./auth";
import { isValidStaffUsername, normalizeStaffUsername } from "@contracts/auth";

const PIN_FAILURE_WINDOW_MS = 5 * 60_000;
const PIN_FAILURE_LIMIT = 8;
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
const PASSKEY_LOGIN_WINDOW_MS = 60_000;
const PASSKEY_LOGIN_ATTEMPT_LIMIT = 20;
const PASSKEY_LOGIN_CHALLENGE_LIMIT = 10;
const passkeyLoginTimesByIp = new Map<string, number[]>();

function configuredPasskeyRp(): { rpID: string; origin: string } | null {
  const rpID = env.passkeyRpId.toLowerCase();
  const configuredOrigin = env.passkeyOrigin.replace(/\/+$/, "");
  if (!rpID || !configuredOrigin || rpID.length > 253) return null;
  if (
    !rpID
      .split(".")
      .every(
        label =>
          label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
  ) {
    return null;
  }
  try {
    const origin = new URL(configuredOrigin);
    const hostname = origin.hostname.toLowerCase();
    if (
      configuredOrigin !== origin.origin ||
      (hostname !== rpID && !hostname.endsWith(`.${rpID}`)) ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          (hostname === "localhost" || hostname === "127.0.0.1")
        ))
    ) {
      return null;
    }
    return { rpID, origin: origin.origin };
  } catch {
    return null;
  }
}

function passkeyRpForRequest(
  request: Request
): { rpID: string; origin: string } | null {
  const config = configuredPasskeyRp();
  if (!config) return null;
  const origin = request.headers.get("origin");
  if (origin && origin !== config.origin) return null;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== config.origin) return null;
    } catch {
      return null;
    }
  }
  return config;
}

function requirePasskeyRp(request: Request): { rpID: string; origin: string } {
  const config = passkeyRpForRequest(request);
  if (!config) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ยังไม่ได้ตั้งค่า Passkey สำหรับโดเมนนี้",
    });
  }
  return config;
}

function assertPasskeyLoginRateLimit(request: Request): void {
  const ip = clientIpFromReq(request);
  const now = Date.now();
  const recent = (passkeyLoginTimesByIp.get(ip) ?? []).filter(
    time => now - time < PASSKEY_LOGIN_WINDOW_MS
  );
  if (recent.length >= PASSKEY_LOGIN_ATTEMPT_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "พยายามเข้าใช้งานด้วย Passkey บ่อยเกินไป กรุณารอสักครู่",
    });
  }
  if (passkeyLoginTimesByIp.size >= 5_000) passkeyLoginTimesByIp.clear();
  recent.push(now);
  passkeyLoginTimesByIp.set(ip, recent);
}

const base64urlValue = z
  .string()
  .min(1)
  .max(131_072)
  .regex(/^[A-Za-z0-9_-]+$/);
const registrationResponseInput = z
  .object({
    id: base64urlValue.max(2_048),
    rawId: base64urlValue.max(2_048),
    type: z.literal("public-key"),
    response: z
      .object({
        clientDataJSON: base64urlValue,
        attestationObject: base64urlValue,
      })
      .passthrough(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const authenticationResponseInput = z
  .object({
    id: base64urlValue.max(2_048),
    rawId: base64urlValue.max(2_048),
    type: z.literal("public-key"),
    response: z
      .object({
        clientDataJSON: base64urlValue,
        authenticatorData: base64urlValue,
        signature: base64urlValue,
        userHandle: base64urlValue.nullable().optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
  })
  .passthrough();

type Db = ReturnType<typeof getDb>;

async function removeExpiredPasskeyChallenges(db: Db): Promise<void> {
  await db
    .delete(passkeyChallenges)
    .where(lte(passkeyChallenges.expiresAt, new Date()));
}

async function recordPinAttempt(input: {
  db: Db;
  branchId: number;
  username: string;
  success: boolean;
  ip: string;
}) {
  await input.db.insert(loginAttempts).values({
    branchId: input.branchId,
    username: input.username,
    success: input.success,
    ip: input.ip,
  });
}

async function assertPinAttemptAllowed(db: Db, ip: string): Promise<void> {
  const recent = await db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.success, false),
        gte(
          loginAttempts.createdAt,
          new Date(Date.now() - PIN_FAILURE_WINDOW_MS)
        )
      )
    )
    .limit(PIN_FAILURE_LIMIT);
  if (recent.length >= PIN_FAILURE_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "กรอก PIN ผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่",
    });
  }
}

async function issueStaffLoginSession(
  user: typeof staffUsers.$inferSelect,
  branchId: number
) {
  const staff = await staffSessionResponse(user, branchId);
  const useLocalSession =
    env.localAuthEnabled || env.isTest || isDevelopmentRuntime();
  const sessionToken = useLocalSession
    ? issueStaffSession({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        username: staff.username,
        branchId: staff.branchId,
        branchCode: staff.branchCode,
        branchName: staff.branchName,
      })
    : null;
  const authSession = useLocalSession
    ? null
    : await issueSupabaseStaffSession(user.username, user.supabaseAuthUserId!);
  return {
    staff: {
      ...staff,
      ...(sessionToken ? { sessionToken } : {}),
    },
    authSession,
  };
}

export const staffAuthRouter = createRouter({
  passkeyStatus: anonymousQuery.query(({ ctx }) => ({
    available: passkeyRpForRequest(ctx.req) !== null,
  })),

  beginPasskeyRegistration: publicQuery.mutation(async ({ ctx }) => {
    const config = requirePasskeyRp(ctx.req);
    const db = getDb();
    const user = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, ctx.staff.id),
    });
    if (!user?.active) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    let userHandle = user.passkeyUserHandle;
    if (!userHandle) {
      const generated = randomBytes(32).toString("base64url");
      const [updated] = await db
        .update(staffUsers)
        .set({ passkeyUserHandle: generated })
        .where(
          and(eq(staffUsers.id, user.id), isNull(staffUsers.passkeyUserHandle))
        )
        .returning({ passkeyUserHandle: staffUsers.passkeyUserHandle });
      userHandle =
        updated?.passkeyUserHandle ??
        (
          await db.query.staffUsers.findFirst({
            columns: { passkeyUserHandle: true },
            where: eq(staffUsers.id, user.id),
          })
        )?.passkeyUserHandle ??
        null;
    }
    if (!userHandle) {
      throw new TRPCError({ code: "PRECONDITION_FAILED" });
    }
    const existing = await db.query.passkeyCredentials.findMany({
      columns: { id: true, transports: true },
      where: eq(passkeyCredentials.staffId, user.id),
    });
    if (existing.length >= 10) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "บัญชีนี้ลงทะเบียน Passkey ครบจำนวนแล้ว",
      });
    }
    const options = await generateRegistrationOptions({
      rpName: "PumpPOS",
      rpID: config.rpID,
      userName: user.username,
      userDisplayName: user.name,
      userID: new Uint8Array(Buffer.from(userHandle, "base64url")),
      attestationType: "none",
      excludeCredentials: existing.map(credential => ({
        id: credential.id,
        transports: credential.transports ?? undefined,
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
    });
    await removeExpiredPasskeyChallenges(db);
    const challengeId = randomUUID();
    await db.insert(passkeyChallenges).values({
      id: challengeId,
      purpose: "registration",
      challenge: options.challenge,
      staffId: user.id,
      userHandle,
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS),
    });
    return { challengeId, options };
  }),

  completePasskeyRegistration: publicQuery
    .input(z.object({ challengeId: z.string().uuid(), response: z.unknown() }))
    .mutation(async ({ input, ctx }) => {
      const config = requirePasskeyRp(ctx.req);
      const db = getDb();
      const [challenge] = await db
        .update(passkeyChallenges)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passkeyChallenges.id, input.challengeId),
            eq(passkeyChallenges.purpose, "registration"),
            eq(passkeyChallenges.staffId, ctx.staff.id),
            isNull(passkeyChallenges.consumedAt),
            gt(passkeyChallenges.expiresAt, new Date())
          )
        )
        .returning();
      if (!challenge?.userHandle) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const response = registrationResponseInput.safeParse(input.response);
      if (!response.success) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.id, ctx.staff.id),
      });
      if (!user?.active || user.passkeyUserHandle !== challenge.userHandle) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response: response.data as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpID,
          requireUserVerification: true,
        });
      } catch {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (!verified.verified || !verified.registrationInfo.userVerified) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const credential = verified.registrationInfo.credential;
      const [inserted] = await db
        .insert(passkeyCredentials)
        .values({
          id: credential.id,
          staffId: user.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: passkeyCredentials.id });
      if (!inserted) {
        throw new TRPCError({ code: "CONFLICT" });
      }
      logAudit({
        action: "passkey_register",
        ...actorFromReq(ctx.req),
        detail: `${user.name} ลงทะเบียน Passkey`,
        refType: "staff_user",
        refId: user.id,
      });
      return { ok: true as const, credentialId: credential.id };
    }),

  beginPasskeyLogin: anonymousQuery.mutation(async ({ ctx }) => {
    const config = requirePasskeyRp(ctx.req);
    assertPasskeyLoginRateLimit(ctx.req);
    const db = getDb();
    await removeExpiredPasskeyChallenges(db);
    const requestIp = clientIpFromReq(ctx.req);
    const recentChallenges = await db
      .select({ id: passkeyChallenges.id })
      .from(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.purpose, "authentication"),
          eq(passkeyChallenges.requestIp, requestIp),
          gte(
            passkeyChallenges.createdAt,
            new Date(Date.now() - PASSKEY_LOGIN_WINDOW_MS)
          )
        )
      )
      .limit(PASSKEY_LOGIN_CHALLENGE_LIMIT);
    if (recentChallenges.length >= PASSKEY_LOGIN_CHALLENGE_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "พยายามเข้าใช้งานด้วย Passkey บ่อยเกินไป กรุณารอสักครู่",
      });
    }
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: [],
      userVerification: "required",
    });
    const challengeId = randomUUID();
    await db.insert(passkeyChallenges).values({
      id: challengeId,
      purpose: "authentication",
      challenge: options.challenge,
      requestIp,
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS),
    });
    return { challengeId, options };
  }),

  completePasskeyLogin: anonymousQuery
    .input(z.object({ challengeId: z.string().uuid(), response: z.unknown() }))
    .mutation(async ({ input, ctx }) => {
      const config = requirePasskeyRp(ctx.req);
      const db = getDb();
      const [challenge] = await db
        .update(passkeyChallenges)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passkeyChallenges.id, input.challengeId),
            eq(passkeyChallenges.purpose, "authentication"),
            isNull(passkeyChallenges.consumedAt),
            gt(passkeyChallenges.expiresAt, new Date())
          )
        )
        .returning();
      if (!challenge) throw new TRPCError({ code: "UNAUTHORIZED" });
      assertPasskeyLoginRateLimit(ctx.req);
      const response = authenticationResponseInput.safeParse(input.response);
      if (!response.success) throw new TRPCError({ code: "BAD_REQUEST" });
      const credential = await db.query.passkeyCredentials.findFirst({
        where: eq(passkeyCredentials.id, response.data.id),
      });
      if (!credential) throw new TRPCError({ code: "UNAUTHORIZED" });
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.id, credential.staffId),
      });
      if (
        !user?.active ||
        !user.passkeyUserHandle ||
        (response.data.response.userHandle != null &&
          response.data.response.userHandle !== user.passkeyUserHandle)
      ) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const [membership] = await db
        .select({ branch: branches })
        .from(staffBranches)
        .innerJoin(branches, eq(branches.id, staffBranches.branchId))
        .where(
          and(eq(staffBranches.staffId, user.id), eq(branches.active, true))
        )
        .orderBy(desc(staffBranches.isDefault), asc(branches.id))
        .limit(1);
      const branch = membership?.branch;
      if (!branch) throw new TRPCError({ code: "UNAUTHORIZED" });
      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response: response.data as AuthenticationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpID,
          credential: {
            id: credential.id,
            publicKey: new Uint8Array(
              Buffer.from(credential.publicKey, "base64url")
            ),
            counter: credential.counter,
            transports: credential.transports ?? undefined,
          },
          requireUserVerification: true,
        });
      } catch {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (!verified.verified || !verified.authenticationInfo.userVerified) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const [updated] = await db
        .update(passkeyCredentials)
        .set({
          counter: verified.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        })
        .where(
          and(
            eq(passkeyCredentials.id, credential.id),
            eq(passkeyCredentials.counter, credential.counter)
          )
        )
        .returning({ id: passkeyCredentials.id });
      if (!updated) throw new TRPCError({ code: "UNAUTHORIZED" });
      const session = await issueStaffLoginSession(user, branch.id);
      logAudit({
        action: "passkey_login",
        ...actorFromReq(ctx.req),
        detail: `${user.name} เข้าสู่ระบบด้วย Passkey`,
        refType: "staff_user",
        refId: user.id,
      });
      return session;
    }),

  loginWithPin: anonymousQuery
    .input(
      z.object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(100)
          .refine(isValidStaffUsername),
        pin: z.string().regex(/^\d{4,6}$/, "PIN ต้องเป็นตัวเลข 4-6 หลัก"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ip = clientIpFromReq(ctx.req);
      await assertPinAttemptAllowed(db, ip);
      const username = normalizeStaffUsername(input.username);
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, username),
      });
      const membership = user
        ? await db.query.staffBranches.findFirst({
            where: eq(staffBranches.staffId, user.id),
            orderBy: desc(staffBranches.isDefault),
          })
        : null;
      const validPin =
        user?.active &&
        membership &&
        (verifyLegacyStaffPin(input.pin, user.pin) ||
          (await verifyStaffPin(input.pin, user.pin)));
      if (!validPin || !user || !membership) {
        const fallbackBranch =
          membership?.branchId ??
          (
            await db.query.branches.findFirst({
              where: eq(branches.active, true),
              columns: { id: true },
            })
          )?.id;
        if (fallbackBranch) {
          await recordPinAttempt({
            db,
            branchId: fallbackBranch,
            username,
            success: false,
            ip,
          });
        }
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง",
        });
      }
      if (!env.localAuthEnabled && !env.isTest && !user.supabaseAuthUserId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "บัญชีนี้ยังไม่พร้อมเข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบ",
        });
      }
      if (isLegacyStaffPinHash(user.pin)) {
        await db
          .update(staffUsers)
          .set({ pin: hashStaffPin(input.pin) })
          .where(and(eq(staffUsers.id, user.id), eq(staffUsers.pin, user.pin)));
      }
      const session = await issueStaffLoginSession(user, membership.branchId);
      await recordPinAttempt({
        db,
        branchId: membership.branchId,
        username: user.username,
        success: true,
        ip,
      });
      logAudit({
        action: "pin_login",
        ...actorFromReq(ctx.req),
        detail: `${user.name} เข้าสู่ระบบด้วย PIN`,
        refType: "staff_user",
        refId: user.id,
      });
      return session;
    }),
});

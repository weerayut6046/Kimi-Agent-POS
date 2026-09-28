import { TRPCError } from "@trpc/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  INITIAL_INSTALLATION_KEY,
  type CreateInitialOwnerInput,
  type InitialSetupState,
  type InitialSetupCheck,
} from "@contracts/initialSetup";
import { normalizeMenuPermissions } from "@contracts/menuPermissions";
import {
  branches,
  employeeFaceProfiles,
  passkeyCredentials,
  settings,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { env, isDevelopmentRuntime } from "./env";
import { clearActiveStaffCache } from "./authorization";
import {
  encryptFaceEmbeddings,
  FACE_MODEL,
  normalizeFaceEmbeddings,
  decryptFaceEmbeddings,
  verifyFaceSamples,
} from "./faceBiometrics";
import { hashStaffPin } from "./staffPin";
import {
  createSupabaseStaffIdentity,
  deleteSupabaseStaffIdentity,
  issueSupabaseStaffSession,
} from "./supabaseAuth";
import { issueStaffSession } from "./session";
import { staffSessionResponse } from "../routers/auth";

type InitialDb = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "execute"
>;
const RETRY_MS = 10 * 60_000;
const pendingMarker = z
  .object({
    version: z.literal(1),
    status: z.literal("unclaimed"),
    seedOwnerId: z.number().int().positive(),
    pendingPinDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const claimedMarker = z
  .object({
    version: z.literal(1),
    status: z.literal("claimed"),
    ownerId: z.number().int().positive(),
    requestId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    claimedAt: z.iso.datetime(),
    authUserId: z.uuid().nullable(),
  })
  .strict();
type InstallationMarker =
  z.infer<typeof pendingMarker> | z.infer<typeof claimedMarker>;

export function pendingOwnerDigest(pin: string) {
  return createHash("sha256").update(pin).digest("hex");
}

function parseMarker(value: string): InstallationMarker | null {
  try {
    const input = JSON.parse(value);
    const pending = pendingMarker.safeParse(input);
    if (pending.success) return pending.data;
    const claimed = claimedMarker.safeParse(input);
    return claimed.success ? claimed.data : null;
  } catch {
    return null;
  }
}

const operationalTables = [
  "sales",
  "sale_items",
  "shifts",
  "shift_readings",
  "attendance_sessions",
  "attendance_events",
  "employee_profiles",
  "payroll_records",
  "work_schedules",
  "stock_count_sessions",
  "stock_count_items",
  "member_card_batches",
  "member_cards",
  "point_transactions",
  "reward_redemptions",
  "tank_refills",
  "tank_readings",
  "customers",
  "tax_invoices",
  "debt_payments",
  "expenses",
  "price_changes",
  "payment_settings",
  "payment_sessions",
  "assistant_settings",
  "assistant_action_proposals",
  "saas_businesses",
] as const;
const factoryTables = [
  "products",
  "pumps",
  "nozzles",
  "fuel_tanks",
  "members",
  "rewards",
] as const;

export async function hasInitialSetupData(
  db: InitialDb,
  includeFactoryRows = false
) {
  const names = [
    ...operationalTables,
    ...(includeFactoryRows ? factoryTables : []),
  ];
  // Names are fixed server-owned table identifiers; never derived from input.
  const query = sql.raw(
    `select ${names.map(name => `exists(select 1 from pos.${name} limit 1)`).join(" or ")} as present`
  );
  const result = await db.execute(query);
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Array<{ present: boolean }> }).rows;
  if (!rows || typeof rows[0]?.present !== "boolean")
    throw new Error("Unable to verify initial installation data");
  return rows[0].present;
}

export async function inspectInitialInstallation(db: InitialDb) {
  const [users, branchRows, markerRows, [face], [passkey]] = await Promise.all([
    db.select().from(staffUsers),
    db.select().from(branches),
    db
      .select()
      .from(settings)
      .where(eq(settings.key, INITIAL_INSTALLATION_KEY)),
    db
      .select({ id: employeeFaceProfiles.id })
      .from(employeeFaceProfiles)
      .limit(1),
    db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).limit(1),
  ]);
  const marker =
    markerRows.length === 1 ? parseMarker(markerRows[0].value) : null;
  const main =
    branchRows.length === 1 &&
    branchRows[0].code === "MAIN" &&
    branchRows[0].active
      ? branchRows[0]
      : undefined;
  const seedOwner = users.length === 1 ? users[0] : undefined;
  const exactSeed = Boolean(
    main &&
    marker?.status === "unclaimed" &&
    markerRows[0].branchId === main.id &&
    seedOwner?.id === marker.seedOwnerId &&
    seedOwner.username === "admin" &&
    seedOwner.name === "ผู้ดูแลระบบ" &&
    seedOwner.role === "admin" &&
    seedOwner.active &&
    !seedOwner.supabaseAuthUserId &&
    !seedOwner.passkeyUserHandle &&
    /^supabase-auth-pending:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      seedOwner.pin
    ) &&
    pendingOwnerDigest(seedOwner.pin) === marker.pendingPinDigest &&
    !face &&
    !passkey
  );
  const pristine =
    users.length === 0 &&
    markerRows.length === 0 &&
    !face &&
    !passkey &&
    (branchRows.length === 0 || Boolean(main));
  const eligible =
    (exactSeed || pristine) && !(await hasInitialSetupData(db, !exactSeed));
  return {
    eligible,
    marker,
    markerRow: markerRows.length === 1 ? markerRows[0] : undefined,
    main,
    seedOwner: exactSeed ? seedOwner : undefined,
  };
}

function cloudAuthConfigured() {
  if (!env.supabasePublishableKey.trim() || !env.supabaseSecretKey.trim())
    return false;
  try {
    const url = new URL(env.supabaseUrl);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function initialSetupPolicy() {
  const code = env.installationCode;
  const localSession =
    env.localAuthEnabled || env.isTest || isDevelopmentRuntime();
  return {
    requiresInstallationCode: env.isProduction || Boolean(code),
    configured:
      (!env.isProduction || code.length >= 32) &&
      env.appSecret.length >= 32 &&
      (localSession || cloudAuthConfigured()),
    requiresFace: env.isProduction,
    localSession,
  };
}

export async function readInitialSetupState(): Promise<InitialSetupState> {
  const policy = initialSetupPolicy();
  let databaseMode: "supabase" | "local" = "supabase";
  try {
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(env.databaseUrl).hostname
      )
    )
      databaseMode = "local";
  } catch {
    /* Config validity is reported without exposing the connection. */
  }
  const checks: InitialSetupCheck[] = [
    { key: "database", status: env.databaseUrl ? "unavailable" : "missing" },
    { key: "schema", status: "unavailable" },
    {
      key: "session",
      status: env.appSecret.length >= 32 ? "ready" : "missing",
    },
    {
      key: "staff_auth",
      status:
        policy.localSession || cloudAuthConfigured() ? "ready" : "missing",
    },
    {
      key: "installation_code",
      status:
        !policy.requiresInstallationCode ||
        (env.installationCode &&
          (!env.isProduction || env.installationCode.length >= 32))
          ? "ready"
          : "missing",
    },
  ];
  let needsOwner = false;
  if (env.databaseUrl) {
    try {
      const db = getDb();
      await db.execute(sql`select 1 as ok`);
      checks[0].status = "ready";
      try {
        needsOwner = (await inspectInitialInstallation(db)).eligible;
        checks[1].status = "ready";
      } catch {
        /* Missing/outdated schema remains unavailable, never unclaimed. */
      }
    } catch {
      /* Unreachable database remains unavailable, never unclaimed. */
    }
  }
  const systemReady = checks
    .filter(check => check.key !== "installation_code" || needsOwner)
    .every(check => check.status === "ready");
  return {
    needsOwner,
    canCreateOwner: needsOwner && policy.configured && systemReady,
    requiresInstallationCode: policy.requiresInstallationCode,
    requiresFace: policy.requiresFace,
    systemReady,
    databaseMode,
    checks,
  };
}

const rateBuckets = new Map<string, { startedAt: number; attempts: number }>();
export function assertInitialSetupRequest(request: Request) {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(name: string): string | undefined } };
    }
  ).Deno;
  const configured =
    deno?.env?.get("ALLOWED_ORIGINS") ?? process.env.ALLOWED_ORIGINS ?? "";
  const origins = new Set(
    configured
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
  if (!origins.size) origins.add(new URL(request.url).origin);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  try {
    if (origin && (!origins.has(origin) || new URL(origin).origin !== origin))
      throw new Error();
    if (referer && !origins.has(new URL(referer).origin)) throw new Error();
  } catch {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "ไม่อนุญาตให้เริ่มติดตั้งจากที่อยู่นี้",
    });
  }
  const key = (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0] ||
    "unknown"
  )
    .trim()
    .slice(0, 200);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (bucket && now - bucket.startedAt < 60_000) {
    if (bucket.attempts >= 10)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "ลองเริ่มติดตั้งบ่อยเกินไป กรุณารอหนึ่งนาที",
      });
    bucket.attempts++;
  } else {
    if (rateBuckets.size >= 2048)
      rateBuckets.delete(rateBuckets.keys().next().value!);
    rateBuckets.set(key, { startedAt: now, attempts: 1 });
  }
}

function assertInstallationCode(input: CreateInitialOwnerInput) {
  const policy = initialSetupPolicy();
  if (!policy.configured || env.appSecret.length < 32)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "ชุดติดตั้งยังไม่พร้อมสร้างบัญชีเจ้าของ กรุณาตรวจการตั้งค่าเซิร์ฟเวอร์",
    });
  if (policy.requiresInstallationCode) {
    const supplied = createHash("sha256")
      .update(input.installationCode ?? "")
      .digest();
    const expected = createHash("sha256").update(env.installationCode).digest();
    if (!timingSafeEqual(supplied, expected))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "รหัสเริ่มติดตั้งไม่ถูกต้อง",
      });
  }
  return policy;
}

export async function createInitialOwner(
  input: CreateInitialOwnerInput,
  request: Request
) {
  assertInitialSetupRequest(request);
  const policy = assertInstallationCode(input);
  if (
    policy.requiresFace &&
    (!input.embeddings || input.consentConfirmed !== true)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "กรุณายินยอมและลงทะเบียนใบหน้าของเจ้าของก่อนเริ่มใช้งาน",
    });
  let embeddings: number[][] | undefined;
  try {
    embeddings = input.embeddings
      ? normalizeFaceEmbeddings(input.embeddings)
      : undefined;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "ข้อมูลใบหน้าที่ลงทะเบียนไม่ถูกต้อง กรุณาสแกนใหม่",
    });
  }
  const fingerprint = createHmac("sha256", env.appSecret)
    .update(
      JSON.stringify({
        name: input.name,
        username: input.username,
        pin: input.pin,
        installationCode: input.installationCode ?? "",
        embeddings: embeddings ?? null,
        consentConfirmed: input.consentConfirmed === true,
      })
    )
    .digest("hex");
  let createdAuthId: string | undefined;
  let user: typeof staffUsers.$inferSelect;
  let branchId: number;
  try {
    const claimed = await getDb().transaction(async tx => {
      // Global table lock also serializes seedCore and normal staff writes.
      await tx.execute(
        sql`lock table pos.staff_users in share row exclusive mode`
      );
      const installation = await inspectInitialInstallation(tx);
      if (installation.marker?.status === "claimed") {
        const marker = installation.marker;
        const age = Date.now() - Date.parse(marker.claimedAt);
        const [owner] = await tx
          .select()
          .from(staffUsers)
          .where(eq(staffUsers.id, marker.ownerId));
        if (
          marker.requestId !== input.requestId ||
          marker.fingerprint !== fingerprint ||
          age < 0 ||
          age > RETRY_MS ||
          !owner?.active ||
          owner.role !== "admin" ||
          owner.username !== input.username ||
          owner.name !== input.name ||
          owner.pin !== hashStaffPin(input.pin) ||
          owner.supabaseAuthUserId !== marker.authUserId ||
          (!policy.localSession && !owner.supabaseAuthUserId) ||
          !installation.markerRow
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "ชุดติดตั้งนี้มีเจ้าของแล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิม",
          });
        }
        if (policy.requiresFace) {
          const [profile] = await tx
            .select()
            .from(employeeFaceProfiles)
            .where(eq(employeeFaceProfiles.staffId, owner.id));
          let faceStillValid = false;
          if (profile?.model === FACE_MODEL && embeddings) {
            try {
              faceStillValid = verifyFaceSamples(
                embeddings,
                await decryptFaceEmbeddings(owner.id, profile.templateEncrypted)
              ).accepted;
            } catch {
              /* Revoked or unreadable biometrics never mint a session. */
            }
          }
          if (!faceStillValid)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "ข้อมูลยืนยันตัวตนเปลี่ยนแล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของ",
            });
        }
        return { user: owner, branchId: installation.markerRow.branchId };
      }
      if (!installation.eligible)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "ชุดติดตั้งนี้มีบัญชีหรือข้อมูลเดิมแล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิม",
        });
      let main = installation.main;
      if (!main) {
        [main] = await tx
          .insert(branches)
          .values({ code: "MAIN", name: "สาขาหลัก" })
          .returning();
      }
      const identity = policy.localSession
        ? null
        : await createSupabaseStaffIdentity({
            username: input.username,
            name: input.name,
            role: "admin",
          });
      createdAuthId = identity?.id;
      const fields = {
        name: input.name,
        username: input.username,
        pin: hashStaffPin(input.pin),
        role: "admin" as const,
        active: true,
        accessGroupId: null,
        menuPermissions: normalizeMenuPermissions("admin", null),
        supabaseAuthUserId: identity?.id ?? null,
      };
      const [owner] = installation.seedOwner
        ? await tx
            .update(staffUsers)
            .set(fields)
            .where(eq(staffUsers.id, installation.seedOwner.id))
            .returning()
        : await tx.insert(staffUsers).values(fields).returning();
      await tx
        .insert(staffBranches)
        .values({ staffId: owner.id, branchId: main.id, isDefault: true })
        .onConflictDoUpdate({
          target: [staffBranches.staffId, staffBranches.branchId],
          set: { isDefault: true },
        });
      if (embeddings) {
        const now = new Date();
        await tx.insert(employeeFaceProfiles).values({
          branchId: main.id,
          staffId: owner.id,
          templateEncrypted: await encryptFaceEmbeddings(owner.id, embeddings),
          model: FACE_MODEL,
          embeddingCount: embeddings.length,
          embeddingDimensions: embeddings[0].length,
          consentAt: now,
          enrolledByStaffId: owner.id,
          enrolledAt: now,
          updatedAt: now,
        });
      }
      const marker: z.infer<typeof claimedMarker> = {
        version: 1,
        status: "claimed",
        ownerId: owner.id,
        requestId: input.requestId,
        fingerprint,
        claimedAt: new Date().toISOString(),
        authUserId: identity?.id ?? null,
      };
      await tx
        .insert(settings)
        .values({
          branchId: main.id,
          key: INITIAL_INSTALLATION_KEY,
          value: JSON.stringify(marker),
        })
        .onConflictDoUpdate({
          target: [settings.branchId, settings.key],
          set: { value: JSON.stringify(marker) },
        });
      return { user: owner, branchId: main.id };
    });
    ({ user, branchId } = claimed);
  } catch (error) {
    if (createdAuthId)
      await deleteSupabaseStaffIdentity(createdAuthId).catch(() => undefined);
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "สร้างบัญชีเจ้าของไม่สำเร็จ กรุณาลองคำขอเดิมอีกครั้ง",
    });
  }
  clearActiveStaffCache();
  const staff = await staffSessionResponse(user, branchId);
  if (policy.localSession) {
    return {
      staff,
      sessionToken: issueStaffSession({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        username: staff.username,
        branchId: staff.branchId,
        branchCode: staff.branchCode,
        branchName: staff.branchName,
      }),
    };
  }
  try {
    return {
      staff,
      authSession: await issueSupabaseStaffSession(
        user.username,
        user.supabaseAuthUserId!
      ),
    };
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "สร้างเซสชันเริ่มใช้งานไม่สำเร็จ กรุณาลองคำขอเดิมอีกครั้งภายใน 10 นาที",
    });
  }
}

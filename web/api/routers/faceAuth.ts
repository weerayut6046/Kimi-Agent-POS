import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import {
  branches,
  employeeFaceProfiles,
  loginAttempts,
  staffBranches,
  staffUsers,
} from "@db/schema";
import { anonymousQuery, createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  issueLoginFaceToken,
  verifyLoginFaceToken,
} from "../lib/faceLoginToken";
import {
  decryptFaceEmbeddings,
  encryptFaceEmbeddings,
  FACE_MODEL,
  normalizeFaceEmbeddings,
  verifyFaceSamples,
} from "../lib/faceBiometrics";
import { clientIpFromReq } from "../lib/clientIp";
import { env } from "../lib/env";
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

const MIN_FACE_SCORE = 0.6;
const MIN_REAL_SCORE = 0.6;
const MIN_LIVE_SCORE = 0.6;
const MIN_FACE_SIZE = 160;
const PIN_FAILURE_WINDOW_MS = 5 * 60_000;
const PIN_FAILURE_LIMIT = 8;

const faceEmbedding = z
  .array(z.number().finite().min(-10).max(10))
  .min(128)
  .max(4_096);
const faceQuality = z.object({
  faceScore: z.number().finite().min(0).max(1),
  real: z.number().finite().min(0).max(1),
  live: z.number().finite().min(0).max(1),
  faceSize: z.number().finite().min(0).max(4_096),
  actionSatisfied: z.literal(true),
});
const faceVerificationInput = z
  .object({
    challengeToken: z.string().trim().min(20).max(2_048),
    // Keep the single-frame shape for clients already in the field.
    embedding: faceEmbedding.optional(),
    embeddings: z.array(faceEmbedding).min(3).max(5).optional(),
    quality: faceQuality,
  })
  .refine(input => Boolean(input.embedding) !== Boolean(input.embeddings), {
    message: "ต้องส่งข้อมูลใบหน้ารูปแบบใดรูปแบบหนึ่งเท่านั้น",
  });

function verificationCandidates(input: z.infer<typeof faceVerificationInput>) {
  return normalizeFaceEmbeddings(input.embeddings ?? [input.embedding!]);
}

type Db = ReturnType<typeof getDb>;

const managerFaceEnrollmentAction = publicQuery.use(({ ctx, next }) => {
  if (ctx.staff.role !== "admin" && ctx.staff.role !== "manager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขาเท่านั้น",
    });
  }
  return next({ ctx });
});

async function requireBranchStaff(db: Db, branchId: number, staffId: number) {
  const [staff] = await db
    .select({ id: staffUsers.id, name: staffUsers.name })
    .from(staffUsers)
    .innerJoin(staffBranches, eq(staffBranches.staffId, staffUsers.id))
    .where(
      and(
        eq(staffUsers.id, staffId),
        eq(staffUsers.active, true),
        eq(staffBranches.branchId, branchId)
      )
    )
    .limit(1);
  if (!staff) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ไม่พบพนักงานที่ใช้งานอยู่ในสาขานี้",
    });
  }
  return staff;
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

export const faceAuthRouter = createRouter({
  beginFaceLogin: anonymousQuery
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
      if (
        !env.localAuthEnabled &&
        process.env.NODE_ENV !== "test" &&
        !user.supabaseAuthUserId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "บัญชีนี้ยังไม่พร้อมเข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบ",
        });
      }
      const faceProfile = await db.query.employeeFaceProfiles.findFirst({
        columns: { id: true, model: true },
        where: eq(employeeFaceProfiles.staffId, user.id),
      });
      if (!faceProfile || faceProfile.model !== FACE_MODEL) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ยังไม่ได้ลงทะเบียนใบหน้าที่รองรับ กรุณาติดต่อผู้ดูแลระบบ",
        });
      }
      if (isLegacyStaffPinHash(user.pin)) {
        await db
          .update(staffUsers)
          .set({ pin: hashStaffPin(input.pin) })
          .where(and(eq(staffUsers.id, user.id), eq(staffUsers.pin, user.pin)));
      }
      const challenge = issueLoginFaceToken({
        branchId: membership.branchId,
        staffId: user.id,
      });
      return { ...challenge, staffName: user.name };
    }),

  completeFaceLogin: anonymousQuery
    .input(faceVerificationInput)
    .mutation(async ({ input, ctx }) => {
      let claims;
      try {
        claims = verifyLoginFaceToken(input.challengeToken);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "คำทดสอบใบหน้าไม่ถูกต้อง",
        });
      }
      if (
        input.quality.faceScore < MIN_FACE_SCORE ||
        input.quality.real < MIN_REAL_SCORE ||
        input.quality.live < MIN_LIVE_SCORE ||
        input.quality.faceSize < MIN_FACE_SIZE
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "คุณภาพหรือความเป็นบุคคลจริงของใบหน้ายังไม่ผ่าน กรุณาลองใหม่",
        });
      }
      const db = getDb();
      const ip = clientIpFromReq(ctx.req);
      await assertPinAttemptAllowed(db, ip);
      const membership = await db
        .select({ staff: staffUsers })
        .from(staffUsers)
        .innerJoin(staffBranches, eq(staffBranches.staffId, staffUsers.id))
        .where(
          and(
            eq(staffUsers.id, claims.staffId),
            eq(staffBranches.branchId, claims.branchId),
            eq(staffUsers.active, true)
          )
        )
        .limit(1);
      const user = membership[0]?.staff;
      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "บัญชีพนักงานไม่พร้อมใช้งาน",
        });
      }
      const faceProfile = await db.query.employeeFaceProfiles.findFirst({
        where: eq(employeeFaceProfiles.staffId, user.id),
      });
      if (!faceProfile || faceProfile.model !== FACE_MODEL) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ไม่พบข้อมูลใบหน้าที่รองรับ กรุณาลงทะเบียนใหม่",
        });
      }
      const candidates = verificationCandidates(input);
      const enrolled = await decryptFaceEmbeddings(
        user.id,
        faceProfile.templateEncrypted
      );
      const match = verifyFaceSamples(candidates, enrolled);
      if (!match.accepted) {
        await recordPinAttempt({
          db,
          branchId: claims.branchId,
          username: user.username,
          success: false,
          ip,
        });
        logAudit({
          action: "login_face_rejected",
          ...actorFromReq(ctx.req),
          detail: `${user.name} ยืนยันใบหน้าไม่ผ่าน: ผ่านเกณฑ์ ${match.matchCount}/${candidates.length} เฟรม คะแนนสูงสุด ${match.similarity.toFixed(2)}`,
          refType: "staff_user",
          refId: user.id,
        });
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "ใบหน้าไม่ตรงกับข้อมูลที่ลงทะเบียน กรุณาลองใหม่",
        });
      }
      const staff = await staffSessionResponse(user, claims.branchId);
      const useLocalSession =
        env.localAuthEnabled || process.env.NODE_ENV === "test";
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
        : await issueSupabaseStaffSession(
            user.username,
            user.supabaseAuthUserId!
          );
      await recordPinAttempt({
        db,
        branchId: claims.branchId,
        username: user.username,
        success: true,
        ip,
      });
      logAudit({
        action: "pin_face_login",
        ...actorFromReq(ctx.req),
        detail: `${user.name} เข้าสู่ระบบด้วย PIN และใบหน้า`,
        refType: "staff_user",
        refId: user.id,
      });
      return {
        ok: true as const,
        staff: {
          ...staff,
          ...(sessionToken ? { sessionToken } : {}),
        },
        authSession,
      };
    }),

  faceProfileList: managerFaceEnrollmentAction.query(async ({ ctx }) =>
    getDb()
      .select({
        staffId: staffUsers.id,
        staffName: staffUsers.name,
        role: staffUsers.role,
        enrolledAt: employeeFaceProfiles.enrolledAt,
        updatedAt: employeeFaceProfiles.updatedAt,
        model: employeeFaceProfiles.model,
      })
      .from(staffUsers)
      .innerJoin(staffBranches, eq(staffBranches.staffId, staffUsers.id))
      .leftJoin(
        employeeFaceProfiles,
        eq(employeeFaceProfiles.staffId, staffUsers.id)
      )
      .where(
        and(
          eq(staffBranches.branchId, ctx.staff.branchId),
          eq(staffUsers.active, true)
        )
      )
      .orderBy(asc(staffUsers.name))
  ),

  enrollFace: managerFaceEnrollmentAction
    .input(
      z.object({
        staffId: z.number().int().positive(),
        embeddings: z.array(faceEmbedding).min(3).max(5),
        consentConfirmed: z.literal(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const staff = await requireBranchStaff(
        db,
        ctx.staff.branchId,
        input.staffId
      );
      const embeddings = normalizeFaceEmbeddings(input.embeddings);
      const now = new Date();
      const templateEncrypted = await encryptFaceEmbeddings(
        staff.id,
        embeddings
      );
      await db
        .insert(employeeFaceProfiles)
        .values({
          branchId: ctx.staff.branchId,
          staffId: staff.id,
          templateEncrypted,
          model: FACE_MODEL,
          embeddingCount: embeddings.length,
          embeddingDimensions: embeddings[0]!.length,
          consentAt: now,
          enrolledByStaffId: ctx.staff.id,
          enrolledAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: employeeFaceProfiles.staffId,
          set: {
            branchId: ctx.staff.branchId,
            templateEncrypted,
            model: FACE_MODEL,
            embeddingCount: embeddings.length,
            embeddingDimensions: embeddings[0]!.length,
            consentAt: now,
            enrolledByStaffId: ctx.staff.id,
            enrolledAt: now,
            updatedAt: now,
          },
        });
      logAudit({
        action: "enroll_employee_face",
        ...actorFromReq(ctx.req),
        detail: `ลงทะเบียนข้อมูลใบหน้าของ ${staff.name} จำนวน ${embeddings.length} ตัวอย่าง`,
        refType: "staff_user",
        refId: staff.id,
      });
      return { ok: true, staffId: staff.id, enrolledAt: now };
    }),

  deleteFaceProfile: managerFaceEnrollmentAction
    .input(z.object({ staffId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const staff = await requireBranchStaff(
        db,
        ctx.staff.branchId,
        input.staffId
      );
      const deleted = await db
        .delete(employeeFaceProfiles)
        .where(eq(employeeFaceProfiles.staffId, staff.id))
        .returning({ id: employeeFaceProfiles.id });
      if (deleted.length > 0) {
        logAudit({
          action: "delete_employee_face",
          ...actorFromReq(ctx.req),
          detail: `ลบข้อมูลใบหน้าของ ${staff.name}`,
          refType: "staff_user",
          refId: staff.id,
        });
      }
      return { ok: true, deleted: deleted.length > 0 };
    }),
});

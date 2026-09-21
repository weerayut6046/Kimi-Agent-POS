import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceEvents,
  attendanceSessions,
  employeeFaceProfiles,
  staffBranches,
  staffUsers,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { authenticatedStaffAction, createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  attendanceFaceIdempotencyKey,
  issueAttendanceFaceToken,
  issueAttendanceQrToken,
  verifyAttendanceFaceToken,
  verifyAttendanceQrToken,
  type AttendanceAction,
} from "../lib/attendanceToken";
import {
  bestFaceSimilarity,
  decryptFaceEmbeddings,
  encryptFaceEmbeddings,
  FACE_MATCH_THRESHOLD,
  FACE_MODEL,
  normalizeFaceEmbeddings,
} from "../lib/faceBiometrics";
import { publishRealtimeInvalidation } from "../lib/realtime";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const SCHEDULE_EARLY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCHEDULE_LATE_WINDOW_MS = 4 * 60 * 60 * 1000;
const MIN_FACE_SCORE = 0.6;
const MIN_REAL_SCORE = 0.6;
const MIN_LIVE_SCORE = 0.6;
const MIN_FACE_SIZE = 160;

const dateText = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/, "รูปแบบวันที่ไม่ถูกต้อง");
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

type Db = ReturnType<typeof getDb>;
type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];
type AttendanceDb = Db | TransactionDb;

function bangkokDate(value: Date): string {
  return new Date(value.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function bangkokDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0));
}

function plannedTimes(
  workDate: string,
  startTime: string,
  endTime: string
): { start: Date; end: Date } {
  const start = bangkokDateTime(workDate, startTime);
  let end = bangkokDateTime(workDate, endTime);
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

async function matchingSchedule(
  db: AttendanceDb,
  branchId: number,
  staffId: number,
  occurredAt: Date
) {
  const today = bangkokDate(occurredAt);
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const rows = await db
    .select({
      id: workSchedules.id,
      workDate: workSchedules.workDate,
      shiftTemplateId: workSchedules.shiftTemplateId,
      shiftName: workShiftTemplates.name,
      startTime: workShiftTemplates.startTime,
      endTime: workShiftTemplates.endTime,
      breakMinutes: workShiftTemplates.breakMinutes,
    })
    .from(workSchedules)
    .innerJoin(
      workShiftTemplates,
      eq(workShiftTemplates.id, workSchedules.shiftTemplateId)
    )
    .where(
      and(
        eq(workSchedules.branchId, branchId),
        eq(workSchedules.staffId, staffId),
        eq(workSchedules.status, "scheduled"),
        inArray(workSchedules.workDate, dates)
      )
    );

  return (
    rows
      .map(row => ({
        ...row,
        ...plannedTimes(row.workDate, row.startTime, row.endTime),
      }))
      .filter(
        row =>
          occurredAt.getTime() >=
            row.start.getTime() - SCHEDULE_EARLY_WINDOW_MS &&
          occurredAt.getTime() <= row.end.getTime() + SCHEDULE_LATE_WINDOW_MS
      )
      .sort(
        (a, b) =>
          Math.abs(occurredAt.getTime() - a.start.getTime()) -
          Math.abs(occurredAt.getTime() - b.start.getTime())
      )[0] ?? null
  );
}

function sessionView(session: typeof attendanceSessions.$inferSelect) {
  return {
    ...session,
    nextAction: session.status === "open" ? ("clock_out" as const) : null,
  };
}

const managerAttendanceAction = authenticatedStaffAction.use(
  ({ ctx, next }) => {
    if (ctx.staff.role !== "admin" && ctx.staff.role !== "manager") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขาเท่านั้น",
      });
    }
    return next({ ctx });
  }
);

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

async function recordFaceAttendance(input: {
  db: Db;
  branchId: number;
  staffId: number;
  action: AttendanceAction;
  idempotencyKey: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}) {
  return input.db.transaction(async tx => {
    await tx.execute(
      sql`select "id" from "pos"."staff_users" where "id" = ${input.staffId} for update`
    );
    const existingEvent = await tx.query.attendanceEvents.findFirst({
      where: eq(attendanceEvents.idempotencyKey, input.idempotencyKey),
    });
    if (existingEvent) {
      const existingSession = await tx.query.attendanceSessions.findFirst({
        where: and(
          eq(attendanceSessions.id, existingEvent.sessionId),
          eq(attendanceSessions.staffId, input.staffId),
          eq(attendanceSessions.branchId, input.branchId)
        ),
      });
      if (!existingSession) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "พบเหตุการณ์ลงเวลาซ้ำแต่ไม่พบรายการกะที่เกี่ยวข้อง",
        });
      }
      return {
        created: false,
        duplicate: true,
        action: existingEvent.eventType,
        session: existingSession,
      };
    }

    const openSession = await tx.query.attendanceSessions.findFirst({
      where: and(
        eq(attendanceSessions.branchId, input.branchId),
        eq(attendanceSessions.staffId, input.staffId),
        eq(attendanceSessions.status, "open")
      ),
      orderBy: desc(attendanceSessions.clockInAt),
    });

    if (input.action === "clock_in") {
      if (openSession) {
        return {
          created: false,
          duplicate: true,
          action: "clock_in" as const,
          session: openSession,
        };
      }
      const schedule = await matchingSchedule(
        tx,
        input.branchId,
        input.staffId,
        input.occurredAt
      );
      const lateMinutes = schedule
        ? Math.max(
            0,
            Math.floor(
              (input.occurredAt.getTime() - schedule.start.getTime()) / 60_000
            )
          )
        : 0;
      const [created] = await tx
        .insert(attendanceSessions)
        .values({
          branchId: input.branchId,
          staffId: input.staffId,
          scheduleId: schedule?.id ?? null,
          workDate: schedule?.workDate ?? bangkokDate(input.occurredAt),
          plannedStartAt: schedule?.start ?? null,
          plannedEndAt: schedule?.end ?? null,
          plannedBreakMinutes: schedule?.breakMinutes ?? 0,
          clockInAt: input.occurredAt,
          clockInMethod: "face",
          status: "open",
          reviewStatus: schedule ? "not_required" : "pending",
          lateMinutes,
        })
        .returning();
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "บันทึกเวลาเข้างานไม่สำเร็จ",
        });
      }
      await tx.insert(attendanceEvents).values({
        branchId: input.branchId,
        staffId: input.staffId,
        sessionId: created.id,
        eventType: "clock_in",
        method: "face",
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
        deviceLabel: "employee_web_face",
        metadata: input.metadata,
      });
      return {
        created: true,
        duplicate: false,
        action: "clock_in" as const,
        session: created,
      };
    }

    if (!openSession) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "ยังไม่มีเวลาเข้างานที่เปิดอยู่ จึงยังบันทึกเวลาออกงานไม่ได้",
      });
    }
    const totalMinutes = Math.max(
      0,
      Math.floor(
        (input.occurredAt.getTime() - openSession.clockInAt.getTime()) / 60_000
      )
    );
    const workedMinutes = Math.max(
      0,
      totalMinutes - openSession.plannedBreakMinutes
    );
    const earlyLeaveMinutes = openSession.plannedEndAt
      ? Math.max(
          0,
          Math.ceil(
            (openSession.plannedEndAt.getTime() - input.occurredAt.getTime()) /
              60_000
          )
        )
      : 0;
    const [completed] = await tx
      .update(attendanceSessions)
      .set({
        clockOutAt: input.occurredAt,
        clockOutMethod: "face",
        status: "completed",
        earlyLeaveMinutes,
        workedMinutes,
        updatedAt: input.occurredAt,
      })
      .where(
        and(
          eq(attendanceSessions.id, openSession.id),
          eq(attendanceSessions.status, "open")
        )
      )
      .returning();
    if (!completed) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "รายการลงเวลานี้ถูกปิดจากอุปกรณ์อื่นแล้ว",
      });
    }
    await tx.insert(attendanceEvents).values({
      branchId: input.branchId,
      staffId: input.staffId,
      sessionId: completed.id,
      eventType: "clock_out",
      method: "face",
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
      deviceLabel: "employee_web_face",
      metadata: input.metadata,
    });
    if (completed.scheduleId) {
      await tx
        .update(workSchedules)
        .set({ status: "completed" })
        .where(
          and(
            eq(workSchedules.id, completed.scheduleId),
            eq(workSchedules.branchId, input.branchId),
            eq(workSchedules.staffId, input.staffId)
          )
        );
    }
    return {
      created: true,
      duplicate: false,
      action: "clock_out" as const,
      session: completed,
    };
  });
}

export const attendanceRouter = createRouter({
  myStatus: authenticatedStaffAction.query(async ({ ctx }) => {
    const db = getDb();
    const openSession = await db.query.attendanceSessions.findFirst({
      where: and(
        eq(attendanceSessions.branchId, ctx.staff.branchId),
        eq(attendanceSessions.staffId, ctx.staff.id),
        eq(attendanceSessions.status, "open")
      ),
      orderBy: desc(attendanceSessions.clockInAt),
    });
    const recent = await db.query.attendanceSessions.findMany({
      where: and(
        eq(attendanceSessions.branchId, ctx.staff.branchId),
        eq(attendanceSessions.staffId, ctx.staff.id)
      ),
      orderBy: desc(attendanceSessions.clockInAt),
      limit: 7,
    });
    const faceProfile = await db.query.employeeFaceProfiles.findFirst({
      columns: { id: true, model: true, updatedAt: true },
      where: eq(employeeFaceProfiles.staffId, ctx.staff.id),
    });
    return {
      serverTime: new Date(),
      nextAction: openSession ? ("clock_out" as const) : ("clock_in" as const),
      openSession: openSession ? sessionView(openSession) : null,
      recent: recent.map(sessionView),
      faceProfile: faceProfile
        ? {
            enrolled: true as const,
            model: faceProfile.model,
            updatedAt: faceProfile.updatedAt,
          }
        : { enrolled: false as const, model: null, updatedAt: null },
    };
  }),

  issueQrChallenge: managerAttendanceAction.mutation(({ ctx }) => ({
    ...issueAttendanceQrToken(ctx.staff.branchId),
    branchId: ctx.staff.branchId,
    branchName: ctx.staff.branchName,
  })),

  faceProfileList: managerAttendanceAction.query(async ({ ctx }) =>
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

  enrollFace: managerAttendanceAction
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

  deleteFaceProfile: managerAttendanceAction
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

  beginFaceVerification: authenticatedStaffAction
    .input(
      z.object({
        qrToken: z.string().trim().min(20).max(2_048),
        purpose: z.enum(["attendance", "login"]).default("attendance"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let qrClaims;
      try {
        qrClaims = verifyAttendanceQrToken(input.qrToken);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "ตรวจสอบ QR ลงเวลาไม่สำเร็จ",
        });
      }
      if (qrClaims.branchId !== ctx.staff.branchId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "QR นี้เป็นของสาขาอื่น กรุณาสแกน QR ของสาขาที่กำลังทำงาน",
        });
      }
      const db = getDb();
      const faceProfile = await db.query.employeeFaceProfiles.findFirst({
        columns: { id: true, model: true },
        where: eq(employeeFaceProfiles.staffId, ctx.staff.id),
      });
      if (!faceProfile) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ยังไม่ได้ลงทะเบียนใบหน้า กรุณาติดต่อผู้จัดการสาขา",
        });
      }
      if (faceProfile.model !== FACE_MODEL) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "รูปแบบข้อมูลใบหน้าเดิมไม่รองรับ กรุณาลงทะเบียนใบหน้าใหม่",
        });
      }
      const openSession = await db.query.attendanceSessions.findFirst({
        columns: { id: true },
        where: and(
          eq(attendanceSessions.branchId, ctx.staff.branchId),
          eq(attendanceSessions.staffId, ctx.staff.id),
          eq(attendanceSessions.status, "open")
        ),
      });
      // Login always verifies/creates a clock-in. If an open attendance
      // session already exists, recordFaceAttendance returns it as a safe
      // duplicate instead of accidentally clocking the employee out.
      const attendanceAction: AttendanceAction =
        input.purpose === "login"
          ? "clock_in"
          : openSession
            ? "clock_out"
            : "clock_in";
      const challenge = issueAttendanceFaceToken({
        qrClaims,
        staffId: ctx.staff.id,
        attendanceAction,
      });
      return {
        ...challenge,
        attendanceAction,
        staffName: ctx.staff.name,
      };
    }),

  completeFaceVerification: authenticatedStaffAction
    .input(
      z.object({
        challengeToken: z.string().trim().min(20).max(2_048),
        embedding: faceEmbedding,
        quality: faceQuality,
      })
    )
    .mutation(async ({ input, ctx }) => {
      let claims;
      try {
        claims = verifyAttendanceFaceToken(input.challengeToken);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "ตรวจสอบคำทดสอบใบหน้าไม่สำเร็จ",
        });
      }
      if (
        claims.staffId !== ctx.staff.id ||
        claims.branchId !== ctx.staff.branchId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "คำทดสอบใบหน้านี้ไม่ได้ออกให้บัญชีหรือสาขาปัจจุบัน",
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
      const faceProfile = await db.query.employeeFaceProfiles.findFirst({
        where: eq(employeeFaceProfiles.staffId, ctx.staff.id),
      });
      if (!faceProfile || faceProfile.model !== FACE_MODEL) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ไม่พบข้อมูลใบหน้าที่รองรับ กรุณาลงทะเบียนใบหน้าใหม่",
        });
      }
      const candidate = normalizeFaceEmbeddings([input.embedding])[0]!;
      const enrolled = await decryptFaceEmbeddings(
        ctx.staff.id,
        faceProfile.templateEncrypted
      );
      const similarity = bestFaceSimilarity(candidate, enrolled);
      if (similarity < FACE_MATCH_THRESHOLD) {
        logAudit({
          action: "attendance_face_rejected",
          ...actorFromReq(ctx.req),
          detail: `ตรวจใบหน้าไม่ผ่าน คะแนน ${similarity.toFixed(2)}`,
          refType: "staff_user",
          refId: ctx.staff.id,
        });
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "ใบหน้าไม่ตรงกับข้อมูลที่ลงทะเบียน กรุณาลองใหม่หรือติดต่อผู้จัดการ",
        });
      }

      const occurredAt = new Date();
      const result = await recordFaceAttendance({
        db,
        branchId: ctx.staff.branchId,
        staffId: ctx.staff.id,
        action: claims.attendanceAction,
        idempotencyKey: attendanceFaceIdempotencyKey(claims),
        occurredAt,
        metadata: {
          faceModel: FACE_MODEL,
          similarity,
          threshold: FACE_MATCH_THRESHOLD,
          livenessAction: claims.livenessAction,
          faceScore: input.quality.faceScore,
          real: input.quality.real,
          live: input.quality.live,
          faceSize: input.quality.faceSize,
        },
      });
      if (result.created) {
        publishRealtimeInvalidation(ctx.staff.branchId);
        logAudit({
          action:
            result.action === "clock_in"
              ? "attendance_clock_in"
              : "attendance_clock_out",
          ...actorFromReq(ctx.req),
          detail: `${ctx.staff.name} ${
            result.action === "clock_in" ? "เข้างาน" : "ออกงาน"
          }ด้วยใบหน้า เวลา ${occurredAt.toISOString()} คะแนน ${similarity.toFixed(2)}${
            result.session.reviewStatus === "pending"
              ? " (ไม่พบกะในตาราง รอตรวจสอบ)"
              : ""
          }`,
          refType: "attendance_session",
          refId: result.session.id,
        });
      }
      return {
        ok: true,
        duplicate: result.duplicate,
        action: result.action,
        similarity,
        session: sessionView(result.session),
      };
    }),

  branchList: managerAttendanceAction
    .input(z.object({ workDate: dateText }))
    .query(async ({ input, ctx }) =>
      getDb()
        .select({
          id: attendanceSessions.id,
          workDate: attendanceSessions.workDate,
          staffId: attendanceSessions.staffId,
          staffName: staffUsers.name,
          scheduleId: attendanceSessions.scheduleId,
          shiftName: workShiftTemplates.name,
          clockInAt: attendanceSessions.clockInAt,
          clockOutAt: attendanceSessions.clockOutAt,
          clockInMethod: attendanceSessions.clockInMethod,
          clockOutMethod: attendanceSessions.clockOutMethod,
          status: attendanceSessions.status,
          reviewStatus: attendanceSessions.reviewStatus,
          lateMinutes: attendanceSessions.lateMinutes,
          earlyLeaveMinutes: attendanceSessions.earlyLeaveMinutes,
          workedMinutes: attendanceSessions.workedMinutes,
        })
        .from(attendanceSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, attendanceSessions.staffId))
        .leftJoin(
          workSchedules,
          eq(workSchedules.id, attendanceSessions.scheduleId)
        )
        .leftJoin(
          workShiftTemplates,
          eq(workShiftTemplates.id, workSchedules.shiftTemplateId)
        )
        .where(
          and(
            eq(attendanceSessions.branchId, ctx.staff.branchId),
            eq(attendanceSessions.workDate, input.workDate)
          )
        )
        .orderBy(asc(attendanceSessions.clockInAt))
    ),
});

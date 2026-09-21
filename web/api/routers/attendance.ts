import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceEvents,
  attendanceSessions,
  staffUsers,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { authenticatedStaffAction, createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  attendanceQrIdempotencyKey,
  issueAttendanceQrToken,
  verifyAttendanceQrToken,
} from "../lib/attendanceToken";
import { publishRealtimeInvalidation } from "../lib/realtime";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const SCHEDULE_EARLY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCHEDULE_LATE_WINDOW_MS = 4 * 60 * 60 * 1000;
const dateText = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/, "รูปแบบวันที่ไม่ถูกต้อง");
const attendanceAction = z.enum(["clock_in", "clock_out"]);

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
    return {
      serverTime: new Date(),
      nextAction: openSession ? ("clock_out" as const) : ("clock_in" as const),
      openSession: openSession ? sessionView(openSession) : null,
      recent: recent.map(sessionView),
    };
  }),

  issueQrChallenge: managerAttendanceAction.mutation(({ ctx }) => {
    const issued = issueAttendanceQrToken(ctx.staff.branchId);
    return {
      ...issued,
      branchId: ctx.staff.branchId,
      branchName: ctx.staff.branchName,
    };
  }),

  redeemQr: authenticatedStaffAction
    .input(
      z.object({
        token: z.string().trim().min(20).max(2_048),
        action: attendanceAction,
      })
    )
    .mutation(async ({ input, ctx }) => {
      let claims;
      try {
        claims = verifyAttendanceQrToken(input.token);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "ตรวจสอบ QR ลงเวลาไม่สำเร็จ",
        });
      }
      if (claims.branchId !== ctx.staff.branchId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "QR นี้เป็นของสาขาอื่น กรุณาสแกน QR ของสาขาที่กำลังทำงาน",
        });
      }

      const db = getDb();
      const occurredAt = new Date();
      const idempotencyKey = attendanceQrIdempotencyKey(claims, ctx.staff.id);
      const result = await db.transaction(async tx => {
        // ล็อกตามพนักงานเพื่อไม่ให้มือถือสองเครื่องสร้างกะเปิดซ้ำพร้อมกัน
        await tx.execute(
          sql`select "id" from "pos"."staff_users" where "id" = ${ctx.staff.id} for update`
        );

        const existingEvent = await tx.query.attendanceEvents.findFirst({
          where: eq(attendanceEvents.idempotencyKey, idempotencyKey),
        });
        if (existingEvent) {
          const existingSession = await tx.query.attendanceSessions.findFirst({
            where: and(
              eq(attendanceSessions.id, existingEvent.sessionId),
              eq(attendanceSessions.staffId, ctx.staff.id),
              eq(attendanceSessions.branchId, ctx.staff.branchId)
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
            eq(attendanceSessions.branchId, ctx.staff.branchId),
            eq(attendanceSessions.staffId, ctx.staff.id),
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
            ctx.staff.branchId,
            ctx.staff.id,
            occurredAt
          );
          const lateMinutes = schedule
            ? Math.max(
                0,
                Math.floor(
                  (occurredAt.getTime() - schedule.start.getTime()) / 60_000
                )
              )
            : 0;
          const [created] = await tx
            .insert(attendanceSessions)
            .values({
              branchId: ctx.staff.branchId,
              staffId: ctx.staff.id,
              scheduleId: schedule?.id ?? null,
              workDate: schedule?.workDate ?? bangkokDate(occurredAt),
              plannedStartAt: schedule?.start ?? null,
              plannedEndAt: schedule?.end ?? null,
              plannedBreakMinutes: schedule?.breakMinutes ?? 0,
              clockInAt: occurredAt,
              clockInMethod: "qr",
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
            branchId: ctx.staff.branchId,
            staffId: ctx.staff.id,
            sessionId: created.id,
            eventType: "clock_in",
            method: "qr",
            occurredAt,
            idempotencyKey,
            deviceLabel: "employee_web",
            metadata: { qrVersion: claims.version },
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
            message:
              "ยังไม่มีเวลาเข้างานที่เปิดอยู่ จึงยังบันทึกเวลาออกงานไม่ได้",
          });
        }
        const totalMinutes = Math.max(
          0,
          Math.floor(
            (occurredAt.getTime() - openSession.clockInAt.getTime()) / 60_000
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
                (openSession.plannedEndAt.getTime() - occurredAt.getTime()) /
                  60_000
              )
            )
          : 0;
        const [completed] = await tx
          .update(attendanceSessions)
          .set({
            clockOutAt: occurredAt,
            clockOutMethod: "qr",
            status: "completed",
            earlyLeaveMinutes,
            workedMinutes,
            updatedAt: occurredAt,
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
          branchId: ctx.staff.branchId,
          staffId: ctx.staff.id,
          sessionId: completed.id,
          eventType: "clock_out",
          method: "qr",
          occurredAt,
          idempotencyKey,
          deviceLabel: "employee_web",
          metadata: { qrVersion: claims.version },
        });
        if (completed.scheduleId) {
          await tx
            .update(workSchedules)
            .set({ status: "completed" })
            .where(
              and(
                eq(workSchedules.id, completed.scheduleId),
                eq(workSchedules.branchId, ctx.staff.branchId),
                eq(workSchedules.staffId, ctx.staff.id)
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
          }ด้วย QR เวลา ${occurredAt.toISOString()}${
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
        session: sessionView(result.session),
      };
    }),

  branchList: managerAttendanceAction
    .input(z.object({ workDate: dateText }))
    .query(async ({ input, ctx }) => {
      return getDb()
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
        .orderBy(asc(attendanceSessions.clockInAt));
    }),
});

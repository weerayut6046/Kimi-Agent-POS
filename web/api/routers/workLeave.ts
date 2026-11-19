import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceSessions,
  auditLogs,
  staffBranches,
  staffUsers,
  workLeaveQuotas,
  workLeaveRequests,
  workSchedules,
} from "@db/schema";
import { leaveCalendarDays, WORK_LEAVE_TYPES } from "@contracts/workLeave";
import { adminQuery, managerQuery } from "../guard";
import { lockWorkforceStaff } from "../lib/workLeave";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";

const yearInput = z.number().int().min(2000).max(2100);
const typeInput = z.enum(WORK_LEAVE_TYPES);
const idInput = z.number().int().positive();
const optionalNote = z.string().trim().max(500).optional();
const reasonInput = z.string().trim().min(3, "กรุณาระบุเหตุผล").max(500);
const daysInput = z.number().int().min(0).max(366);

function leaveYearRange(year: number) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function branchMembership(branchId: number, staffId: number) {
  return and(
    eq(staffBranches.branchId, branchId),
    eq(staffBranches.staffId, staffId)
  );
}

export const workLeaveRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        branchId: idInput.optional(),
        year: yearInput,
        scope: z.enum(["mine", "branch"]).default("mine"),
      })
    )
    .query(async ({ input, ctx }) => {
      const { branchId, id: staffId, role } = ctx.staff;
      if (input.branchId !== undefined && input.branchId !== branchId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "กรุณาเลือกสาขาปัจจุบันอีกครั้ง",
        });
      }
      const isTeam = input.scope === "branch";
      if (isTeam && role === "cashier")
        throw new TRPCError({ code: "FORBIDDEN" });

      const db = getDb();
      const range = leaveYearRange(input.year);
      const [requests, quotas, schedules, employees] = await Promise.all([
        db
          .select({ request: workLeaveRequests, staffName: staffUsers.name })
          .from(workLeaveRequests)
          .innerJoin(staffUsers, eq(staffUsers.id, workLeaveRequests.staffId))
          .where(
            and(
              eq(workLeaveRequests.branchId, branchId),
              gte(workLeaveRequests.startOn, range.start),
              lte(workLeaveRequests.startOn, range.end),
              isTeam ? undefined : eq(workLeaveRequests.staffId, staffId)
            )
          )
          .orderBy(
            desc(workLeaveRequests.createdAt),
            desc(workLeaveRequests.id)
          ),
        db
          .select()
          .from(workLeaveQuotas)
          .where(
            and(
              eq(workLeaveQuotas.branchId, branchId),
              eq(workLeaveQuotas.year, input.year),
              isTeam ? undefined : eq(workLeaveQuotas.staffId, staffId)
            )
          ),
        isTeam
          ? db
              .selectDistinct({
                staffId: workSchedules.staffId,
                workDate: workSchedules.workDate,
              })
              .from(workSchedules)
              .where(
                and(
                  eq(workSchedules.branchId, branchId),
                  gte(workSchedules.workDate, range.start),
                  lte(workSchedules.workDate, range.end)
                )
              )
          : [],
        isTeam
          ? db
              .select({ id: staffUsers.id, name: staffUsers.name })
              .from(staffBranches)
              .innerJoin(staffUsers, eq(staffUsers.id, staffBranches.staffId))
              .where(
                and(
                  eq(staffBranches.branchId, branchId),
                  eq(staffUsers.active, true)
                )
              )
              .orderBy(asc(staffUsers.name), asc(staffUsers.id))
          : [],
      ]);

      const workDays = new Map<number, string[]>();
      for (const schedule of schedules) {
        const dates = workDays.get(schedule.staffId);
        if (dates) dates.push(schedule.workDate);
        else workDays.set(schedule.staffId, [schedule.workDate]);
      }
      return {
        quotas,
        employees,
        requests: requests.map(({ request, staffName }) => ({
          ...request,
          staffName,
          plannedDays: (workDays.get(request.staffId) ?? []).filter(
            date => date >= request.startOn && date <= request.endOn
          ).length,
        })),
      };
    }),

  submit: publicQuery
    .input(
      z
        .object({
          type: typeInput,
          startOn: z.iso.date(),
          endOn: z.iso.date(),
          note: optionalNote,
        })
        .refine(input => input.startOn <= input.endOn, {
          path: ["endOn"],
          message: "วันสิ้นสุดต้องตรงกับหรืออยู่หลังวันเริ่มลา",
        })
        .refine(
          input =>
            input.startOn.slice(0, 4) === input.endOn.slice(0, 4) &&
            yearInput.safeParse(Number(input.startOn.slice(0, 4))).success,
          { path: ["endOn"], message: "กรุณายื่นใบลาแยกตามปีปฏิทิน" }
        )
    )
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: staffId } = ctx.staff;
      const note = input.note || null;
      return getDb().transaction(async tx => {
        await lockWorkforceStaff(tx, staffId);
        const existing = await tx.query.workLeaveRequests.findFirst({
          where: and(
            eq(workLeaveRequests.branchId, branchId),
            eq(workLeaveRequests.staffId, staffId),
            lte(workLeaveRequests.startOn, input.endOn),
            gte(workLeaveRequests.endOn, input.startOn),
            inArray(workLeaveRequests.status, ["pending", "approved"])
          ),
        });
        if (existing) {
          if (
            existing.startOn === input.startOn &&
            existing.endOn === input.endOn &&
            existing.type === input.type &&
            existing.note === note
          ) {
            return { id: existing.id };
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "ช่วงนี้ทับกับใบลาที่รออนุมัติหรืออนุมัติแล้ว",
          });
        }
        const [request] = await tx
          .insert(workLeaveRequests)
          .values({ ...input, note, branchId, staffId })
          .returning({ id: workLeaveRequests.id });
        return request!;
      });
    }),

  cancelMine: publicQuery
    .input(z.object({ id: idInput }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: staffId } = ctx.staff;
      return getDb().transaction(async tx => {
        await lockWorkforceStaff(tx, staffId);
        const [request] = await tx
          .update(workLeaveRequests)
          .set({
            status: "cancelled",
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(workLeaveRequests.id, input.id),
              eq(workLeaveRequests.branchId, branchId),
              eq(workLeaveRequests.staffId, staffId),
              eq(workLeaveRequests.status, "pending")
            )
          )
          .returning({ id: workLeaveRequests.id });
        if (!request)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "ไม่พบใบลาของคุณที่อยู่ระหว่างรออนุมัติ",
          });
        return request;
      });
    }),

  review: managerQuery
    .input(
      z.discriminatedUnion("decision", [
        z.object({
          id: idInput,
          decision: z.literal("approved"),
          days: daysInput,
          note: optionalNote,
        }),
        z.object({
          id: idInput,
          decision: z.literal("rejected"),
          note: reasonInput,
        }),
        z.object({
          id: idInput,
          decision: z.literal("cancelled"),
          note: reasonInput,
        }),
      ])
    )
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: actorId, name: actorName } = ctx.staff;
      return getDb().transaction(async tx => {
        const requestScope = and(
          eq(workLeaveRequests.id, input.id),
          eq(workLeaveRequests.branchId, branchId)
        );
        const subject = await tx.query.workLeaveRequests.findFirst({
          columns: { staffId: true },
          where: requestScope,
        });
        if (!subject)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "ไม่พบใบลาในสาขานี้",
          });
        if (subject.staffId === actorId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "ให้ผู้มีสิทธิ์คนอื่นพิจารณาใบลาของคุณ",
          });

        await lockWorkforceStaff(tx, subject.staffId);
        const request = await tx.query.workLeaveRequests.findFirst({
          where: requestScope,
        });
        const expected =
          input.decision === "cancelled" ? "approved" : "pending";
        if (request?.status !== expected)
          throw new TRPCError({
            code: "CONFLICT",
            message: "สถานะใบลาเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่",
          });

        if (input.decision === "approved") {
          if (input.days > leaveCalendarDays(request.startOn, request.endOn)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "วันใช้สิทธิ์มากกว่าช่วงวันที่ลา",
            });
          }
          const [worked, attendance] = await Promise.all([
            tx.query.workSchedules.findFirst({
              columns: { id: true },
              where: and(
                eq(workSchedules.branchId, branchId),
                eq(workSchedules.staffId, request.staffId),
                gte(workSchedules.workDate, request.startOn),
                lte(workSchedules.workDate, request.endOn),
                eq(workSchedules.status, "completed")
              ),
            }),
            tx.query.attendanceSessions.findFirst({
              columns: { id: true },
              where: and(
                eq(attendanceSessions.branchId, branchId),
                eq(attendanceSessions.staffId, request.staffId),
                gte(attendanceSessions.workDate, request.startOn),
                lte(attendanceSessions.workDate, request.endOn),
                ne(attendanceSessions.reviewStatus, "rejected")
              ),
            }),
          ]);
          if (worked || attendance)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "ช่วงนี้มีบันทึกทำงานแล้ว กรุณาตรวจตารางงานหรือเวลาลงงานก่อนอนุมัติ",
            });
          const year = Number(request.startOn.slice(0, 4));
          const quota = await tx.query.workLeaveQuotas.findFirst({
            where: and(
              eq(workLeaveQuotas.branchId, branchId),
              eq(workLeaveQuotas.staffId, request.staffId),
              eq(workLeaveQuotas.year, year),
              eq(workLeaveQuotas.type, request.type)
            ),
          });
          if (quota && input.days > 0 && !input.note) {
            const range = leaveYearRange(year);
            const [balance] = await tx
              .select({
                used: sql<number>`coalesce(sum(${workLeaveRequests.chargedDays}), 0)::int`,
              })
              .from(workLeaveRequests)
              .where(
                and(
                  eq(workLeaveRequests.branchId, branchId),
                  eq(workLeaveRequests.staffId, request.staffId),
                  eq(workLeaveRequests.type, request.type),
                  eq(workLeaveRequests.status, "approved"),
                  gte(workLeaveRequests.startOn, range.start),
                  lte(workLeaveRequests.startOn, range.end)
                )
              );
            if ((balance?.used ?? 0) + input.days > quota.days) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "จำนวนวันเกินยอดสิทธิ์ที่ตั้งไว้ กรุณาระบุเหตุผลประกอบการอนุมัติ",
              });
            }
          }
        }

        await tx
          .update(workLeaveRequests)
          .set({
            status: input.decision,
            chargedDays:
              input.decision === "approved" ? input.days : request.chargedDays,
            reviewedBy: actorId,
            reviewerName: actorName,
            reviewedAt: new Date(),
            reviewNote: input.note || null,
          })
          .where(requestScope);
        await tx.insert(auditLogs).values({
          branchId,
          action: `work_leave_${input.decision}`,
          actorId,
          actorName,
          detail: `ใบลา #${request.id} · ${request.startOn} ถึง ${request.endOn}`,
          refType: "work_leave",
          refId: request.id,
        });
        return { id: request.id };
      });
    }),

  setQuota: adminQuery
    .input(
      z.object({
        staffId: idInput,
        year: yearInput,
        type: typeInput,
        days: daysInput.nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: actorId, name: actorName } = ctx.staff;
      const { staffId, year, type, days } = input;
      return getDb().transaction(async tx => {
        await lockWorkforceStaff(tx, staffId);
        const membership = await tx.query.staffBranches.findFirst({
          where: branchMembership(branchId, staffId),
        });
        if (!membership)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "ไม่พบพนักงานในสาขานี้",
          });
        if (days === null) {
          await tx
            .delete(workLeaveQuotas)
            .where(
              and(
                eq(workLeaveQuotas.branchId, branchId),
                eq(workLeaveQuotas.staffId, staffId),
                eq(workLeaveQuotas.year, year),
                eq(workLeaveQuotas.type, type)
              )
            );
        } else {
          await tx
            .insert(workLeaveQuotas)
            .values({ branchId, staffId, year, type, days })
            .onConflictDoUpdate({
              target: [
                workLeaveQuotas.branchId,
                workLeaveQuotas.year,
                workLeaveQuotas.staffId,
                workLeaveQuotas.type,
              ],
              set: { days },
            });
        }
        await tx.insert(auditLogs).values({
          branchId,
          action: "work_leave_quota",
          actorId,
          actorName,
          detail: `วันลา ${type} พนักงาน #${staffId} ปี ${year} · ${days ?? "ล้างค่าที่ตั้ง"}`,
          refType: "staff",
          refId: staffId,
        });
        return { ok: true };
      });
    }),
});

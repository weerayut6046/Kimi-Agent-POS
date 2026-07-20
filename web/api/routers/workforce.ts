import { and, asc, eq, gte, lt, lte, ne } from "drizzle-orm";
import { z } from "zod";
import {
  employeeProfiles,
  payrollRecords,
  staffUsers,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { adminQuery, staffIdFromHeader } from "../guard";
import { actorFromReq, logAudit } from "../lib/audit";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";

const dateText = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/, "รูปแบบวันที่ไม่ถูกต้อง");
const monthText = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "รูปแบบเดือนไม่ถูกต้อง");
const timeText = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "รูปแบบเวลาต้องเป็น HH:mm");
const scheduleStatus = z.enum(["scheduled", "completed", "leave", "absent"]);
const salaryType = z.enum(["monthly", "daily", "hourly"]);

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function shiftHours(startTime: string, endTime: string, breakMinutes: number) {
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return round2(Math.max(0, end - start - breakMinutes) / 60);
}

async function requireStaff(staffId: number) {
  const staff = await getDb().query.staffUsers.findFirst({
    where: eq(staffUsers.id, staffId),
  });
  if (!staff) throw new Error("ไม่พบพนักงาน");
  return staff;
}

async function requireTemplate(templateId: number) {
  const template = await getDb().query.workShiftTemplates.findFirst({
    where: eq(workShiftTemplates.id, templateId),
  });
  if (!template) throw new Error("ไม่พบรูปแบบกะงาน");
  return template;
}

export const workforceRouter = createRouter({
  listTemplates: publicQuery.query(async () =>
    getDb()
      .select()
      .from(workShiftTemplates)
      .orderBy(asc(workShiftTemplates.startTime))
  ),

  upsertTemplate: adminQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1),
        startTime: timeText,
        endTime: timeText,
        breakMinutes: z.number().int().min(0).max(720).default(0),
        active: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const values = {
        name: input.name,
        startTime: input.startTime,
        endTime: input.endTime,
        breakMinutes: input.breakMinutes,
        active: input.active,
      };
      let id = input.id;
      if (id) {
        await requireTemplate(id);
        await db
          .update(workShiftTemplates)
          .set(values)
          .where(eq(workShiftTemplates.id, id));
      } else {
        [{ id }] = await db
          .insert(workShiftTemplates)
          .values(values)
          .returning({ id: workShiftTemplates.id });
      }
      logAudit({
        action: input.id
          ? "update_work_shift_template"
          : "create_work_shift_template",
        ...actorFromReq(ctx.req),
        detail: `${input.id ? "แก้ไข" : "เพิ่ม"}รูปแบบกะ ${input.name} ${input.startTime}-${input.endTime}`,
        refType: "work_shift_template",
        refId: id,
      });
      return { ok: true, id };
    }),

  deleteTemplate: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const template = await requireTemplate(input.id);
      const linked = await getDb().query.workSchedules.findFirst({
        where: eq(workSchedules.shiftTemplateId, input.id),
      });
      if (linked) {
        throw new Error("กะนี้ถูกใช้ในตารางงานแล้ว กรุณาปิดใช้งานแทนการลบ");
      }
      await getDb()
        .delete(workShiftTemplates)
        .where(eq(workShiftTemplates.id, input.id));
      logAudit({
        action: "delete_work_shift_template",
        ...actorFromReq(ctx.req),
        detail: `ลบรูปแบบกะ ${template.name}`,
        refType: "work_shift_template",
        refId: input.id,
      });
      return { ok: true };
    }),

  directory: publicQuery.query(async () => {
    const rows = await getDb()
      .select({
        id: staffUsers.id,
        username: staffUsers.username,
        name: staffUsers.name,
        role: staffUsers.role,
        position: employeeProfiles.position,
      })
      .from(staffUsers)
      .leftJoin(employeeProfiles, eq(employeeProfiles.staffId, staffUsers.id))
      .where(eq(staffUsers.active, true))
      .orderBy(asc(staffUsers.name));
    return rows;
  }),

  scheduleList: publicQuery
    .input(z.object({ startDate: dateText, endDate: dateText }))
    .query(async ({ input, ctx }) => {
      if (input.endDate < input.startDate)
        throw new Error("ช่วงวันที่ไม่ถูกต้อง");
      const role = ctx.req.headers.get("x-staff-role");
      const currentStaffId = staffIdFromHeader(ctx.req);
      if (role !== "admin" && currentStaffId == null) {
        throw new Error("ไม่พบข้อมูลผู้ใช้งาน");
      }
      const filters = [
        gte(workSchedules.workDate, input.startDate),
        lte(workSchedules.workDate, input.endDate),
      ];
      if (role !== "admin")
        filters.push(eq(workSchedules.staffId, currentStaffId!));
      return getDb()
        .select({
          id: workSchedules.id,
          workDate: workSchedules.workDate,
          shiftTemplateId: workSchedules.shiftTemplateId,
          staffId: workSchedules.staffId,
          status: workSchedules.status,
          note: workSchedules.note,
          staffName: staffUsers.name,
          staffRole: staffUsers.role,
          shiftName: workShiftTemplates.name,
          startTime: workShiftTemplates.startTime,
          endTime: workShiftTemplates.endTime,
          breakMinutes: workShiftTemplates.breakMinutes,
        })
        .from(workSchedules)
        .innerJoin(staffUsers, eq(staffUsers.id, workSchedules.staffId))
        .innerJoin(
          workShiftTemplates,
          eq(workShiftTemplates.id, workSchedules.shiftTemplateId)
        )
        .where(and(...filters))
        .orderBy(
          asc(workSchedules.workDate),
          asc(workShiftTemplates.startTime),
          asc(staffUsers.name)
        );
    }),

  createSchedule: adminQuery
    .input(
      z.object({
        workDate: dateText,
        shiftTemplateId: z.number().int().positive(),
        staffId: z.number().int().positive(),
        status: scheduleStatus.default("scheduled"),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [staff, template] = await Promise.all([
        requireStaff(input.staffId),
        requireTemplate(input.shiftTemplateId),
      ]);
      if (!staff.active) throw new Error("พนักงานคนนี้ถูกปิดใช้งาน");
      if (!template.active) throw new Error("รูปแบบกะนี้ถูกปิดใช้งาน");
      const duplicate = await getDb().query.workSchedules.findFirst({
        where: and(
          eq(workSchedules.workDate, input.workDate),
          eq(workSchedules.shiftTemplateId, input.shiftTemplateId),
          eq(workSchedules.staffId, input.staffId)
        ),
      });
      if (duplicate)
        throw new Error("พนักงานคนนี้มีกะดังกล่าวในวันที่เลือกแล้ว");
      const [{ id }] = await getDb()
        .insert(workSchedules)
        .values(input)
        .returning({ id: workSchedules.id });
      logAudit({
        action: "create_work_schedule",
        ...actorFromReq(ctx.req),
        detail: `จัด ${staff.name} เข้ากะ ${template.name} วันที่ ${input.workDate}`,
        refType: "work_schedule",
        refId: id,
      });
      return { ok: true, id };
    }),

  updateSchedule: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        workDate: dateText,
        shiftTemplateId: z.number().int().positive(),
        staffId: z.number().int().positive(),
        status: scheduleStatus,
        note: z.string().trim().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = await db.query.workSchedules.findFirst({
        where: eq(workSchedules.id, input.id),
      });
      if (!existing) throw new Error("ไม่พบรายการตารางงาน");
      const [staff, template] = await Promise.all([
        requireStaff(input.staffId),
        requireTemplate(input.shiftTemplateId),
      ]);
      const duplicate = await db.query.workSchedules.findFirst({
        where: and(
          eq(workSchedules.workDate, input.workDate),
          eq(workSchedules.shiftTemplateId, input.shiftTemplateId),
          eq(workSchedules.staffId, input.staffId),
          ne(workSchedules.id, input.id)
        ),
      });
      if (duplicate)
        throw new Error("พนักงานคนนี้มีกะดังกล่าวในวันที่เลือกแล้ว");
      const { id, ...values } = input;
      await db
        .update(workSchedules)
        .set(values)
        .where(eq(workSchedules.id, id));
      logAudit({
        action: "update_work_schedule",
        ...actorFromReq(ctx.req),
        detail: `แก้ตารางงาน ${staff.name} เป็นกะ ${template.name} วันที่ ${input.workDate}`,
        refType: "work_schedule",
        refId: id,
      });
      return { ok: true };
    }),

  deleteSchedule: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const schedule = await getDb().query.workSchedules.findFirst({
        where: eq(workSchedules.id, input.id),
      });
      if (!schedule) throw new Error("ไม่พบรายการตารางงาน");
      await getDb().delete(workSchedules).where(eq(workSchedules.id, input.id));
      logAudit({
        action: "delete_work_schedule",
        ...actorFromReq(ctx.req),
        detail: `ลบตารางงานวันที่ ${schedule.workDate}`,
        refType: "work_schedule",
        refId: input.id,
      });
      return { ok: true };
    }),

  swapSchedules: adminQuery
    .input(
      z.object({
        firstId: z.number().int().positive(),
        secondId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.firstId === input.secondId)
        throw new Error("กรุณาเลือกกะงาน 2 รายการ");
      const db = getDb();
      const [first, second] = await Promise.all([
        db.query.workSchedules.findFirst({
          where: eq(workSchedules.id, input.firstId),
        }),
        db.query.workSchedules.findFirst({
          where: eq(workSchedules.id, input.secondId),
        }),
      ]);
      if (!first || !second) throw new Error("ไม่พบรายการกะงานที่ต้องการสลับ");
      if (first.staffId === second.staffId)
        throw new Error("ทั้งสองกะเป็นพนักงานคนเดียวกัน");

      const [firstCollision, secondCollision] = await Promise.all([
        db.query.workSchedules.findFirst({
          where: and(
            eq(workSchedules.workDate, first.workDate),
            eq(workSchedules.shiftTemplateId, first.shiftTemplateId),
            eq(workSchedules.staffId, second.staffId),
            ne(workSchedules.id, second.id)
          ),
        }),
        db.query.workSchedules.findFirst({
          where: and(
            eq(workSchedules.workDate, second.workDate),
            eq(workSchedules.shiftTemplateId, second.shiftTemplateId),
            eq(workSchedules.staffId, first.staffId),
            ne(workSchedules.id, first.id)
          ),
        }),
      ]);
      if (firstCollision || secondCollision) {
        throw new Error("สลับไม่ได้ เพราะพนักงานมีกะซ้ำในช่วงที่เลือก");
      }

      db.transaction(tx => {
        tx.update(workSchedules)
          .set({ staffId: -first.staffId })
          .where(eq(workSchedules.id, first.id))
          .run();
        tx.update(workSchedules)
          .set({ staffId: first.staffId })
          .where(eq(workSchedules.id, second.id))
          .run();
        tx.update(workSchedules)
          .set({ staffId: second.staffId })
          .where(eq(workSchedules.id, first.id))
          .run();
      });
      const [firstStaff, secondStaff] = await Promise.all([
        requireStaff(first.staffId),
        requireStaff(second.staffId),
      ]);
      logAudit({
        action: "swap_work_schedules",
        ...actorFromReq(ctx.req),
        detail: `สลับกะระหว่าง ${firstStaff.name} และ ${secondStaff.name}`,
        refType: "work_schedule",
        refId: first.id,
      });
      return { ok: true };
    }),

  employeeProfiles: adminQuery.query(async () => {
    const rows = await getDb()
      .select({
        staffId: staffUsers.id,
        username: staffUsers.username,
        name: staffUsers.name,
        role: staffUsers.role,
        active: staffUsers.active,
        profileId: employeeProfiles.id,
        position: employeeProfiles.position,
        salaryType: employeeProfiles.salaryType,
        baseRate: employeeProfiles.baseRate,
        overtimeRate: employeeProfiles.overtimeRate,
        hireDate: employeeProfiles.hireDate,
        note: employeeProfiles.note,
      })
      .from(staffUsers)
      .leftJoin(employeeProfiles, eq(employeeProfiles.staffId, staffUsers.id))
      .orderBy(asc(staffUsers.name));
    return rows;
  }),

  myProfile: publicQuery.query(async ({ ctx }) => {
    const staffId = staffIdFromHeader(ctx.req);
    if (!staffId) throw new Error("ไม่พบข้อมูลผู้ใช้งาน");
    const [row] = await getDb()
      .select({
        staffId: staffUsers.id,
        username: staffUsers.username,
        name: staffUsers.name,
        role: staffUsers.role,
        active: staffUsers.active,
        position: employeeProfiles.position,
        salaryType: employeeProfiles.salaryType,
        baseRate: employeeProfiles.baseRate,
        overtimeRate: employeeProfiles.overtimeRate,
        hireDate: employeeProfiles.hireDate,
        note: employeeProfiles.note,
      })
      .from(staffUsers)
      .leftJoin(employeeProfiles, eq(employeeProfiles.staffId, staffUsers.id))
      .where(eq(staffUsers.id, staffId));
    if (!row) throw new Error("ไม่พบพนักงาน");
    return row;
  }),

  upsertEmployeeProfile: adminQuery
    .input(
      z.object({
        staffId: z.number().int().positive(),
        position: z.string().trim().max(100).default(""),
        salaryType: salaryType.default("monthly"),
        baseRate: z.number().min(0),
        overtimeRate: z.number().min(0),
        hireDate: dateText.nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const staff = await requireStaff(input.staffId);
      await getDb()
        .insert(employeeProfiles)
        .values(input)
        .onConflictDoUpdate({
          target: employeeProfiles.staffId,
          set: {
            position: input.position,
            salaryType: input.salaryType,
            baseRate: input.baseRate,
            overtimeRate: input.overtimeRate,
            hireDate: input.hireDate ?? null,
            note: input.note ?? null,
          },
        });
      logAudit({
        action: "update_employee_profile",
        ...actorFromReq(ctx.req),
        detail: `แก้ข้อมูลพนักงานและค่าจ้าง ${staff.name}`,
        refType: "staff",
        refId: staff.id,
      });
      return { ok: true };
    }),

  payrollList: adminQuery
    .input(z.object({ month: monthText }))
    .query(async ({ input }) =>
      getDb()
        .select({
          id: payrollRecords.id,
          payrollMonth: payrollRecords.payrollMonth,
          staffId: payrollRecords.staffId,
          staffName: staffUsers.name,
          position: employeeProfiles.position,
          salaryType: employeeProfiles.salaryType,
          workDays: payrollRecords.workDays,
          workHours: payrollRecords.workHours,
          baseAmount: payrollRecords.baseAmount,
          overtimeHours: payrollRecords.overtimeHours,
          overtimeAmount: payrollRecords.overtimeAmount,
          bonus: payrollRecords.bonus,
          deduction: payrollRecords.deduction,
          netAmount: payrollRecords.netAmount,
          status: payrollRecords.status,
          paidAt: payrollRecords.paidAt,
          note: payrollRecords.note,
        })
        .from(payrollRecords)
        .innerJoin(staffUsers, eq(staffUsers.id, payrollRecords.staffId))
        .leftJoin(
          employeeProfiles,
          eq(employeeProfiles.staffId, payrollRecords.staffId)
        )
        .where(eq(payrollRecords.payrollMonth, input.month))
        .orderBy(asc(staffUsers.name))
    ),

  myPayroll: publicQuery
    .input(z.object({ month: monthText }))
    .query(async ({ input, ctx }) => {
      const staffId = staffIdFromHeader(ctx.req);
      if (!staffId) throw new Error("ไม่พบข้อมูลผู้ใช้งาน");
      return getDb().query.payrollRecords.findFirst({
        where: and(
          eq(payrollRecords.payrollMonth, input.month),
          eq(payrollRecords.staffId, staffId)
        ),
      });
    }),

  generatePayroll: adminQuery
    .input(z.object({ month: monthText }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const monthStart = `${input.month}-01`;
      const monthEnd = nextMonth(input.month);
      const [profiles, schedules, existingRecords] = await Promise.all([
        db
          .select({
            staffId: employeeProfiles.staffId,
            staffName: staffUsers.name,
            salaryType: employeeProfiles.salaryType,
            baseRate: employeeProfiles.baseRate,
            overtimeRate: employeeProfiles.overtimeRate,
          })
          .from(employeeProfiles)
          .innerJoin(staffUsers, eq(staffUsers.id, employeeProfiles.staffId))
          .where(eq(staffUsers.active, true)),
        db
          .select({
            staffId: workSchedules.staffId,
            workDate: workSchedules.workDate,
            status: workSchedules.status,
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
              gte(workSchedules.workDate, monthStart),
              lt(workSchedules.workDate, monthEnd)
            )
          ),
        db.query.payrollRecords.findMany({
          where: eq(payrollRecords.payrollMonth, input.month),
        }),
      ]);

      let generated = 0;
      let skippedPaid = 0;
      db.transaction(tx => {
        for (const profile of profiles) {
          const current = existingRecords.find(
            record => record.staffId === profile.staffId
          );
          if (current?.status === "paid") {
            skippedPaid += 1;
            continue;
          }
          const worked = schedules.filter(
            schedule =>
              schedule.staffId === profile.staffId &&
              schedule.status !== "leave" &&
              schedule.status !== "absent"
          );
          const workDays = new Set(worked.map(schedule => schedule.workDate))
            .size;
          const workHours = round2(
            worked.reduce(
              (sum, schedule) =>
                sum +
                shiftHours(
                  schedule.startTime,
                  schedule.endTime,
                  schedule.breakMinutes
                ),
              0
            )
          );
          const baseAmount = round2(
            profile.salaryType === "monthly"
              ? profile.baseRate
              : profile.salaryType === "daily"
                ? workDays * profile.baseRate
                : workHours * profile.baseRate
          );
          const overtimeHours = current?.overtimeHours ?? 0;
          const overtimeAmount = round2(overtimeHours * profile.overtimeRate);
          const bonus = current?.bonus ?? 0;
          const deduction = current?.deduction ?? 0;
          const netAmount = round2(
            baseAmount + overtimeAmount + bonus - deduction
          );
          const values = {
            payrollMonth: input.month,
            staffId: profile.staffId,
            workDays,
            workHours,
            baseAmount,
            overtimeHours,
            overtimeAmount,
            bonus,
            deduction,
            netAmount,
            note: current?.note ?? null,
          };
          if (current) {
            tx.update(payrollRecords)
              .set(values)
              .where(eq(payrollRecords.id, current.id))
              .run();
          } else {
            tx.insert(payrollRecords).values(values).run();
          }
          generated += 1;
        }
      });
      logAudit({
        action: "generate_payroll",
        ...actorFromReq(ctx.req),
        detail: `คำนวณเงินเดือน ${input.month} จำนวน ${generated} คน`,
        refType: "payroll_month",
      });
      return { ok: true, generated, skippedPaid };
    }),

  updatePayroll: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        overtimeHours: z.number().min(0),
        bonus: z.number().min(0),
        deduction: z.number().min(0),
        note: z.string().trim().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const record = await db.query.payrollRecords.findFirst({
        where: eq(payrollRecords.id, input.id),
      });
      if (!record) throw new Error("ไม่พบรายการเงินเดือน");
      if (record.status === "paid")
        throw new Error("รายการที่จ่ายแล้วไม่สามารถแก้ไขได้");
      const profile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.staffId, record.staffId),
      });
      if (!profile) throw new Error("ไม่พบข้อมูลค่าจ้างของพนักงาน");
      const overtimeAmount = round2(input.overtimeHours * profile.overtimeRate);
      const netAmount = round2(
        record.baseAmount + overtimeAmount + input.bonus - input.deduction
      );
      await db
        .update(payrollRecords)
        .set({
          overtimeHours: input.overtimeHours,
          overtimeAmount,
          bonus: input.bonus,
          deduction: input.deduction,
          netAmount,
          note: input.note ?? null,
        })
        .where(eq(payrollRecords.id, input.id));
      logAudit({
        action: "update_payroll",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขเงินเดือน ${record.payrollMonth}`,
        refType: "payroll",
        refId: record.id,
      });
      return { ok: true, overtimeAmount, netAmount };
    }),

  setPayrollStatus: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "paid"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const record = await getDb().query.payrollRecords.findFirst({
        where: eq(payrollRecords.id, input.id),
      });
      if (!record) throw new Error("ไม่พบรายการเงินเดือน");
      await getDb()
        .update(payrollRecords)
        .set({
          status: input.status,
          paidAt: input.status === "paid" ? new Date() : null,
        })
        .where(eq(payrollRecords.id, input.id));
      logAudit({
        action: input.status === "paid" ? "payroll_paid" : "payroll_reopen",
        ...actorFromReq(ctx.req),
        detail: `${input.status === "paid" ? "บันทึกจ่าย" : "เปิดแก้ไข"}เงินเดือน ${record.payrollMonth}`,
        refType: "payroll",
        refId: record.id,
      });
      return { ok: true };
    }),
});

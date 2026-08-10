import { z } from "zod";
import { createRouter } from "../middleware";
import { adminQuery } from "../guard";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  loadManagedBackupHealth,
  loadRestoreDrillRecord,
  saveRestoreDrillRecord,
  type RestoreDrillChecks,
} from "../lib/backupHealth";
import { env } from "../lib/env";

const managedBackupMessage =
  "ระบบ Cloud ใช้ Supabase Managed Backups การสร้างและกู้คืนสำเนาฐานข้อมูลต้องทำจาก Supabase Dashboard";

function managedBackupOnly(): never {
  throw new Error(managedBackupMessage);
}

const restoreDrillChecksSchema = z.object({
  login: z.boolean(),
  dashboard: z.boolean(),
  shifts: z.boolean(),
  sales: z.boolean(),
  stock: z.boolean(),
  credit: z.boolean(),
  audit: z.boolean(),
});

const restoreDrillInputSchema = z
  .object({
    performedAt: z.string().datetime(),
    result: z.enum(["passed", "failed"]),
    rpoMinutes: z.number().int().min(0).max(10_080),
    rtoMinutes: z.number().int().min(1).max(10_080),
    targetProject: z.string().trim().min(3).max(100),
    backupReference: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(1_000),
    checks: restoreDrillChecksSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.result === "passed" &&
      !Object.values(value.checks).every(Boolean)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "ผลผ่านต้องตรวจสอบรายการสำคัญครบทุกข้อ",
      });
    }
  });

export const dbadminEdgeRouter = createRouter({
  dbInfo: adminQuery.query(async ({ ctx }) => {
    const [managedBackupHealth, lastRestoreDrill] = await Promise.all([
      loadManagedBackupHealth(),
      loadRestoreDrillRecord(ctx.staff.branchId),
    ]);
    return {
      provider: "supabase" as const,
      dbPath: "Supabase PostgreSQL",
      projectRef: env.supabaseProjectRef,
      backupMode: "managed-only" as const,
      supabasePlan: "Pro",
      supabaseDailyRetentionDays: 7,
      supabaseDashboardUrl: env.supabaseProjectRef
        ? `https://supabase.com/dashboard/project/${env.supabaseProjectRef}/database/backups/scheduled`
        : "https://supabase.com/dashboard",
      supabaseRestoreToNewProjectUrl: env.supabaseProjectRef
        ? `https://supabase.com/dashboard/project/${env.supabaseProjectRef}/database/backups/restore-to-new-project`
        : "https://supabase.com/dashboard",
      managedBackupHealth,
      lastRestoreDrill,
      restoreDrillCadenceDays: 90,
      storageObjectsIncluded: false,
      offsiteAvailable: false,
      offsiteConfigured: false,
      offsiteDeleteEnabled: false,
      offsiteBucket: "",
      offsiteSchedule: "ไม่รองรับใน Edge runtime",
      offsiteDailyRetentionDays: 0,
      offsiteMonthlyRetentionDays: 0,
      backups: [],
      backupListError: "",
      managedRestoreMessage: managedBackupMessage,
    };
  }),
  recordRestoreDrill: adminQuery
    .input(restoreDrillInputSchema)
    .mutation(async ({ input, ctx }) => {
      const performedAt = new Date(input.performedAt);
      if (performedAt.getTime() > Date.now() + 5 * 60 * 1_000) {
        throw new Error("เวลาซ้อมกู้คืนอยู่ในอนาคต");
      }
      const actor = actorFromReq(ctx.req);
      const record = {
        version: 1 as const,
        ...input,
        checks: input.checks satisfies RestoreDrillChecks,
        actorId: ctx.staff.id,
        actorName: ctx.staff.name,
        recordedAt: new Date().toISOString(),
      };
      await saveRestoreDrillRecord(ctx.staff.branchId, record);
      logAudit({
        action: "record_restore_drill",
        ...actor,
        detail: `บันทึกผลซ้อมกู้คืน ${record.result === "passed" ? "ผ่าน" : "ไม่ผ่าน"}; RPO ${record.rpoMinutes} นาที; RTO ${record.rtoMinutes} นาที; เป้าหมาย ${record.targetProject}`,
        refType: "database_backup",
      });
      return { ok: true, record };
    }),
  backup: adminQuery.mutation(managedBackupOnly),
  readBackup: adminQuery
    .input(z.object({ fileName: z.string().min(1).max(500) }))
    .query(managedBackupOnly),
  restore: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(managedBackupOnly),
  deleteBackup: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1).max(500),
        confirmation: z.string().min(1).max(255),
      })
    )
    .mutation(managedBackupOnly),
  restoreUpload: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1),
        contentBase64: z.string().min(1),
      })
    )
    .mutation(managedBackupOnly),
});

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
import {
  backupIsConfigured,
  backupDeleteIsEnabled,
  createBackupDownloadUrl,
  createDatabaseBackup,
  deleteManualDatabaseBackup,
  listDatabaseBackups,
} from "../lib/databaseBackup";

const managedRestoreMessage =
  "เพื่อป้องกันข้อมูลสูญหาย การกู้คืนต้องทำลง Supabase project ทดสอบก่อน แล้วตรวจสอบข้อมูลก่อนสลับ project ที่ใช้งาน";

function managedRestoreOnly(): never {
  throw new Error(managedRestoreMessage);
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

export const dbadminRouter = createRouter({
  dbInfo: adminQuery.query(async ({ ctx }) => {
    let backups: Awaited<ReturnType<typeof listDatabaseBackups>> = [];
    let backupListError = "";
    try {
      backups = await listDatabaseBackups();
    } catch (error) {
      console.error("อ่านรายการสำรองฐานข้อมูลจาก GCS ไม่สำเร็จ:", error);
      backupListError = "ไม่สามารถอ่านรายการสำรองจาก Private GCS ได้";
    }

    const [managedBackupHealth, lastRestoreDrill] = await Promise.all([
      loadManagedBackupHealth(),
      loadRestoreDrillRecord(ctx.staff.branchId),
    ]);
    const offsiteConfigured = backupIsConfigured();

    return {
      provider: "supabase" as const,
      dbPath: "Supabase PostgreSQL",
      projectRef: env.supabaseProjectRef,
      backupMode: offsiteConfigured
        ? ("managed-plus-offsite" as const)
        : ("managed-only" as const),
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
      offsiteAvailable: true,
      offsiteConfigured,
      offsiteDeleteEnabled: backupDeleteIsEnabled(),
      offsiteBucket: env.gcsBackupBucket,
      offsiteSchedule: "ทุก 6 ชั่วโมง",
      offsiteDailyRetentionDays: 35,
      offsiteMonthlyRetentionDays: 370,
      backups,
      backupListError,
      managedRestoreMessage,
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

  backup: adminQuery.mutation(async ({ ctx }) => {
    const backup = await createDatabaseBackup("manual");
    const actor = actorFromReq(ctx.req);
    logAudit({
      action: "backup_db",
      ...actor,
      detail: `สร้าง Logical Backup ${backup.fileName} ไปยัง Private GCS`,
      refType: "database_backup",
    });
    return { ok: true, backup };
  }),

  readBackup: adminQuery
    .input(z.object({ fileName: z.string().min(1).max(500) }))
    .query(async ({ input }) => createBackupDownloadUrl(input.fileName)),

  restore: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(managedRestoreOnly),
  deleteBackup: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1).max(500),
        confirmation: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const backup = await deleteManualDatabaseBackup(
        input.fileName,
        input.confirmation
      );
      const actor = actorFromReq(ctx.req);
      logAudit({
        action: "delete_manual_backup",
        ...actor,
        detail: `ลบ Manual Backup ${backup.fileName} จาก Private GCS`,
        refType: "database_backup",
      });
      return { ok: true, backup };
    }),
  restoreUpload: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1),
        contentBase64: z.string().min(1),
      })
    )
    .mutation(managedRestoreOnly),
});

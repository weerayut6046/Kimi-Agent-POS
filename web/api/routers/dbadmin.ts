import { z } from "zod";
import { createRouter } from "../middleware";
import { adminQuery } from "../guard";
import { actorFromReq, logAudit } from "../lib/audit";
import { env } from "../lib/env";
import {
  backupIsConfigured,
  createBackupDownloadUrl,
  createDatabaseBackup,
  listDatabaseBackups,
} from "../lib/databaseBackup";

const managedRestoreMessage =
  "เพื่อป้องกันข้อมูลสูญหาย การกู้คืนต้องทำลง Supabase project ทดสอบก่อน แล้วตรวจสอบข้อมูลก่อนสลับ DATABASE_URL ของ Railway";

function managedRestoreOnly(): never {
  throw new Error(managedRestoreMessage);
}

export const dbadminRouter = createRouter({
  dbInfo: adminQuery.query(async () => {
    let backups: Awaited<ReturnType<typeof listDatabaseBackups>> = [];
    let backupListError = "";
    try {
      backups = await listDatabaseBackups();
    } catch (error) {
      console.error("อ่านรายการสำรองฐานข้อมูลจาก GCS ไม่สำเร็จ:", error);
      backupListError = "ไม่สามารถอ่านรายการสำรองจาก Private GCS ได้";
    }

    return {
      provider: "supabase" as const,
      dbPath: "Supabase PostgreSQL",
      projectRef: env.supabaseProjectRef,
      supabasePlan: "Pro",
      supabaseDailyRetentionDays: 7,
      supabaseDashboardUrl: env.supabaseProjectRef
        ? `https://supabase.com/dashboard/project/${env.supabaseProjectRef}/database/backups/scheduled`
        : "https://supabase.com/dashboard",
      offsiteConfigured: backupIsConfigured(),
      offsiteBucket: env.gcsBackupBucket,
      offsiteSchedule: "ทุก 6 ชั่วโมง",
      offsiteDailyRetentionDays: 35,
      offsiteMonthlyRetentionDays: 370,
      backups,
      backupListError,
      managedRestoreMessage,
    };
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
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(managedRestoreOnly),
  restoreUpload: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1),
        contentBase64: z.string().min(1),
      })
    )
    .mutation(managedRestoreOnly),
});

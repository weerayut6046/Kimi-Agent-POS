import { z } from "zod";
import { createRouter } from "../middleware";
import { adminQuery } from "../guard";
import { env } from "../lib/env";

const managedBackupMessage =
  "ระบบ Cloud ใช้ Supabase Managed Backups การสร้างและกู้คืนสำเนาฐานข้อมูลต้องทำจาก Supabase Dashboard";

function managedBackupOnly(): never {
  throw new Error(managedBackupMessage);
}

export const dbadminEdgeRouter = createRouter({
  dbInfo: adminQuery.query(() => ({
    provider: "supabase" as const,
    dbPath: "Supabase PostgreSQL",
    projectRef: env.supabaseProjectRef,
    supabasePlan: "Pro",
    supabaseDailyRetentionDays: 7,
    supabaseDashboardUrl: env.supabaseProjectRef
      ? `https://supabase.com/dashboard/project/${env.supabaseProjectRef}/database/backups/scheduled`
      : "https://supabase.com/dashboard",
    supabaseRestoreToNewProjectUrl: env.supabaseProjectRef
      ? `https://supabase.com/dashboard/project/${env.supabaseProjectRef}/database/backups/restore-to-new-project`
      : "https://supabase.com/dashboard",
    offsiteConfigured: false,
    offsiteDeleteEnabled: false,
    offsiteBucket: "",
    offsiteSchedule: "Supabase Managed",
    offsiteDailyRetentionDays: 0,
    offsiteMonthlyRetentionDays: 0,
    backups: [],
    backupListError: "",
    managedRestoreMessage: managedBackupMessage,
  })),
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
      }),
    )
    .mutation(managedBackupOnly),
  restoreUpload: adminQuery
    .input(
      z.object({
        fileName: z.string().min(1),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(managedBackupOnly),
});

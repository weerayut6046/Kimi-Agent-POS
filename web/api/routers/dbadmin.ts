import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";

const managedBackupMessage =
  "ฐานข้อมูลอยู่บน Supabase แล้ว กรุณาจัดการ Backup และ Point-in-Time Recovery จาก Supabase Dashboard";

function managedBackupOnly(): never {
  throw new Error(managedBackupMessage);
}

export const dbadminRouter = createRouter({
  dbInfo: publicQuery.query(() => ({
    provider: "supabase" as const,
    dbPath: "Supabase PostgreSQL",
    sizeBytes: 0,
    backups: [] as Array<{ name: string; sizeBytes: number; modifiedAt: Date }>,
    managedBackupMessage,
  })),

  backup: adminQuery.mutation(managedBackupOnly),
  restore: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(managedBackupOnly),
  deleteBackup: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(managedBackupOnly),
  readBackup: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .query(managedBackupOnly),
  restoreUpload: adminQuery
    .input(z.object({ fileName: z.string().min(1), contentBase64: z.string().min(1) }))
    .mutation(managedBackupOnly),
});

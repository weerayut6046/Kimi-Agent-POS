import { z } from "zod";
import { adminQuery } from "../guard";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  createPortableDatabaseBackup,
  portableBackupTableNames,
  restorePortableDatabaseBackup,
} from "../lib/portableDatabaseBackup";
import { createRouter } from "../middleware";

export const FILE_RESTORE_CONFIRMATION = "กู้คืนข้อมูล";
const MAX_BASE64_LENGTH = 44_739_244;

export const dbadminFileRouter = createRouter({
  dbInfo: adminQuery.query(() => ({
    provider: "postgresql" as const,
    dbPath: "PostgreSQL",
    backupMode: "download-file" as const,
    backupFormat: ".posbackup" as const,
    backupStorage: "เครื่องของผู้ดูแล" as const,
    tableCount: portableBackupTableNames.length,
    maxCompressedSizeMb: 32,
    databaseTablesIncluded: true,
    authUsersIncluded: false,
    storageObjectsIncluded: false,
  })),

  backup: adminQuery.mutation(async ({ ctx }) => {
    const backup = await createPortableDatabaseBackup();
    const actor = actorFromReq(ctx.req);
    logAudit({
      action: "backup_db_file",
      ...actor,
      detail: `ส่งออกไฟล์ ${backup.fileName}; ${backup.tableCount} ตาราง; ${backup.totalRows} แถว; SHA-256 ${backup.sha256}`,
      refType: "database_backup",
    });
    return { ok: true, backup };
  }),

  restoreUpload: adminQuery
    .input(
      z
        .object({
          fileName: z
            .string()
            .trim()
            .min(1)
            .max(255)
            .regex(/\.posbackup$/i, "กรุณาเลือกไฟล์ .posbackup"),
          contentBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
          confirmation: z.literal(FILE_RESTORE_CONFIRMATION),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const restored = await restorePortableDatabaseBackup(input);
      const actor = actorFromReq(ctx.req);
      logAudit({
        action: "restore_db_file",
        ...actor,
        detail: `กู้คืนจากไฟล์ ${restored.fileName}; ${restored.tableCount} ตาราง; ${restored.totalRows} แถว; SHA-256 ${restored.sha256}`,
        refType: "database_backup",
      });
      return { ok: true, restored };
    }),
});

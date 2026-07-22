import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  supabaseProjectRef:
    process.env.SUPABASE_PROJECT_REF ||
    (() => {
      try {
        return (
          decodeURIComponent(new URL(required("DATABASE_URL")).username).split(
            "."
          )[1] ?? ""
        );
      } catch {
        return "";
      }
    })(),
  gcsBackupBucket: process.env.GCS_BACKUP_BUCKET ?? "",
  gcsBackupProjectId: process.env.GCS_BACKUP_PROJECT_ID ?? "",
  gcsBackupCredentialsBase64: process.env.GCS_BACKUP_CREDENTIALS_BASE64 ?? "",
  gcsBackupDeleteEnabled:
    process.env.GCS_BACKUP_DELETE_ENABLED?.toLowerCase() === "true",
  backupCronSecret: process.env.BACKUP_CRON_SECRET ?? "",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  pgDumpPath: process.env.PG_DUMP_PATH || "pg_dump",
  pgRestorePath: process.env.PG_RESTORE_PATH || "pg_restore",
};

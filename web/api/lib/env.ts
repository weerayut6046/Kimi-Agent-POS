type DenoEnv = {
  get(name: string): string | undefined;
};

function runtimeValue(name: string): string | undefined {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: DenoEnv };
    }
  ).Deno;
  return deno?.env?.get(name) ?? process.env[name];
}

function required(name: string): string {
  const value = runtimeValue(name);
  const isProduction = isProductionRuntime;
  if (!value && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const isProductionRuntime =
  runtimeValue("NODE_ENV") === "production" ||
  typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined";

const localAuthEnabled =
  !isProductionRuntime &&
  runtimeValue("LOCAL_AUTH_ENABLED")?.trim().toLowerCase() === "true";

const appSecret = runtimeValue("APP_SECRET") ?? "";
if (localAuthEnabled && appSecret.length < 32) {
  throw new Error(
    "APP_SECRET must contain at least 32 characters when LOCAL_AUTH_ENABLED=true"
  );
}

export function projectRefFromSupabaseUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const suffix = ".supabase.co";
    if (!hostname.endsWith(suffix)) return "";
    const projectRef = hostname.slice(0, -suffix.length);
    return /^[a-z0-9]+$/.test(projectRef) ? projectRef : "";
  } catch {
    return "";
  }
}

const databaseUrl = runtimeValue("SUPABASE_DB_URL") || required("DATABASE_URL");
const supabaseUrl = runtimeValue("SUPABASE_URL") ?? "";
const supabaseProjectRef =
  runtimeValue("PUMPPOS_PROJECT_REF")?.trim() ||
  projectRefFromSupabaseUrl(supabaseUrl) ||
  runtimeValue("SUPABASE_PROJECT_REF")?.trim() ||
  (() => {
    try {
      return (
        decodeURIComponent(new URL(databaseUrl).username).split(".")[1] ?? ""
      );
    } catch {
      return "";
    }
  })();

const assistantProvider =
  runtimeValue("AI_ASSISTANT_PROVIDER")?.trim().toLowerCase() ||
  (runtimeValue("DEEPSEEK_API_KEY") ? "deepseek" : "ollama");

if (!["ollama", "deepseek"].includes(assistantProvider)) {
  throw new Error(
    "AI_ASSISTANT_PROVIDER must be either 'ollama' or 'deepseek'"
  );
}

const parsedOllamaTimeoutMs = Number(runtimeValue("OLLAMA_TIMEOUT_MS"));
const parsedMeterAiTimeoutMs = Number(
  runtimeValue("GEMINI_METER_VERIFY_TIMEOUT_MS")
);

export const env = {
  appId: runtimeValue("APP_ID") || "pumppos",
  appSecret,
  isProduction: isProductionRuntime,
  localAuthEnabled,
  localAdminPassword: runtimeValue("LOCAL_ADMIN_PASSWORD") ?? "",
  databaseUrl,
  supabaseProjectRef,
  supabaseUrl:
    supabaseUrl ||
    (supabaseProjectRef ? `https://${supabaseProjectRef}.supabase.co` : ""),
  supabasePublishableKey:
    runtimeValue("SUPABASE_PUBLISHABLE_KEY") ||
    runtimeValue("SUPABASE_ANON_KEY") ||
    "",
  supabaseSecretKey:
    runtimeValue("SUPABASE_SECRET_KEY") ||
    runtimeValue("SUPABASE_SERVICE_ROLE_KEY") ||
    "",
  // Hosted Edge Functions provide the project's public JWKS directly. Using
  // it avoids an Auth network request while still cryptographically verifying
  // every asymmetric access token.
  supabaseJwks: runtimeValue("SUPABASE_JWKS") ?? "",
  // Fine-grained Management API token (permission: backups_read) สำหรับอ่าน
  // สถานะ Managed Backup เท่านั้น ห้ามส่งค่านี้ไป browser หรือใช้ token แบบ write.
  supabaseManagementAccessToken:
    runtimeValue("PUMPPOS_MANAGEMENT_ACCESS_TOKEN") ?? "",
  gcsBackupBucket: runtimeValue("GCS_BACKUP_BUCKET") ?? "",
  gcsBackupProjectId: runtimeValue("GCS_BACKUP_PROJECT_ID") ?? "",
  gcsBackupCredentialsBase64:
    runtimeValue("GCS_BACKUP_CREDENTIALS_BASE64") ?? "",
  gcsBackupDeleteEnabled:
    runtimeValue("GCS_BACKUP_DELETE_ENABLED")?.toLowerCase() === "true",
  backupCronSecret: runtimeValue("BACKUP_CRON_SECRET") ?? "",
  assistantProvider: assistantProvider as "ollama" | "deepseek",
  ollamaBaseUrl: (
    runtimeValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434"
  ).replace(/\/+$/, ""),
  ollamaModel: runtimeValue("OLLAMA_MODEL") || "qwen3:4b-instruct",
  ollamaTimeoutMs:
    Number.isFinite(parsedOllamaTimeoutMs) && parsedOllamaTimeoutMs > 0
      ? Math.min(Math.max(parsedOllamaTimeoutMs, 10_000), 300_000)
      : 180_000,
  deepseekApiKey: runtimeValue("DEEPSEEK_API_KEY") ?? "",
  deepseekModel: runtimeValue("DEEPSEEK_MODEL") || "deepseek-v4-flash",
  // ตรวจสอบ OCR มิเตอร์ซ้ำด้วย Gemini Vision ฝั่ง server เท่านั้น
  meterAiApiKey:
    runtimeValue("GEMINI_METER_VERIFY_API_KEY") ||
    runtimeValue("GEMINI_API_KEY") ||
    runtimeValue("METER_OCR_API_KEY") ||
    "",
  meterAiApiUrl:
    runtimeValue("GEMINI_METER_VERIFY_API_URL") ||
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  meterAiModel: runtimeValue("GEMINI_METER_VERIFY_MODEL") || "gemini-3.6-flash",
  meterAiTimeoutMs:
    Number.isFinite(parsedMeterAiTimeoutMs) && parsedMeterAiTimeoutMs > 0
      ? Math.min(Math.max(parsedMeterAiTimeoutMs, 10_000), 120_000)
      : 30_000,
  // Slip2Go — ตรวจสลิปโอนเงินเข้าบัญชีถุงเงินของร้าน (server-side only)
  slip2goBaseUrl: (
    runtimeValue("SLIP2GO_BASE_URL") || "https://connect.slip2go.com"
  ).replace(/\/+$/, ""),
  slip2goApiSecret: runtimeValue("SLIP2GO_API_SECRET") ?? "",
  slip2goTimeoutMs: (() => {
    const parsed = Number(runtimeValue("SLIP2GO_TIMEOUT_MS"));
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.max(parsed, 1_000), 30_000)
      : 8_000;
  })(),
  slip2goMock: runtimeValue("SLIP2GO_MOCK") === "1",
  pgDumpPath: runtimeValue("PG_DUMP_PATH") || "pg_dump",
  pgRestorePath: runtimeValue("PG_RESTORE_PATH") || "pg_restore",
};

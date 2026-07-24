type DenoEnv = {
  get(name: string): string | undefined;
};

function runtimeValue(name: string): string | undefined {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env?: DenoEnv };
  }).Deno;
  return deno?.env?.get(name) ?? process.env[name];
}

function required(name: string): string {
  const value = runtimeValue(name);
  const isProduction =
    runtimeValue("NODE_ENV") === "production" ||
    typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !==
      "undefined";
  if (!value && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const databaseUrl =
  runtimeValue("SUPABASE_DB_URL") || required("DATABASE_URL");
const supabaseProjectRef =
  runtimeValue("SUPABASE_PROJECT_REF") ||
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

export const env = {
  appId: runtimeValue("APP_ID") || "pumppos",
  appSecret: runtimeValue("APP_SECRET") ?? "",
  isProduction:
    runtimeValue("NODE_ENV") === "production" ||
    typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !==
      "undefined",
  databaseUrl,
  supabaseProjectRef,
  supabaseUrl:
    runtimeValue("SUPABASE_URL") ||
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
  deepseekModel:
    runtimeValue("DEEPSEEK_MODEL") || "deepseek-v4-flash",
  pgDumpPath: runtimeValue("PG_DUMP_PATH") || "pg_dump",
  pgRestorePath: runtimeValue("PG_RESTORE_PATH") || "pg_restore",
};

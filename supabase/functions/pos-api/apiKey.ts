type EnvReader = (name: string) => string | undefined;

export type ProjectApiKeyStatus = "ok" | "missing" | "invalid" | "unconfigured";

function configuredPublishableKeys(readEnv: EnvReader): Set<string> {
  const keys = new Set<string>();
  const encodedKeys = readEnv("SUPABASE_PUBLISHABLE_KEYS")?.trim();
  if (encodedKeys) {
    try {
      const parsed: unknown = JSON.parse(encodedKeys);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const value of Object.values(parsed)) {
          if (typeof value === "string" && value.trim()) keys.add(value.trim());
        }
      }
    } catch {
      // Fall through to the single-key and legacy environment variables.
    }
  }
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) {
    const value = readEnv(name)?.trim();
    if (value) keys.add(value);
  }
  return keys;
}

export function projectApiKeyStatus(
  request: Request,
  readEnv: EnvReader
): ProjectApiKeyStatus {
  const configured = configuredPublishableKeys(readEnv);
  if (configured.size === 0) return "unconfigured";
  const supplied = request.headers.get("apikey")?.trim();
  if (!supplied) return "missing";
  return configured.has(supplied) ? "ok" : "invalid";
}

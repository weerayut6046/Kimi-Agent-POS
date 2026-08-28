export const LOCAL_TOOLING_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
] as const;

/**
 * Production origins remain environment-controlled. The two exact loopback
 * origins are reserved for local preview/audit tooling; arbitrary ports and
 * wildcard origins are intentionally not allowed.
 */
export function createAllowedOrigins(configuredOrigins: string): Set<string> {
  return new Set([
    ...configuredOrigins
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
    ...LOCAL_TOOLING_ORIGINS,
  ]);
}

export function createCorsResponseHeaders(
  origin: string | null,
  allowedOrigins: ReadonlySet<string>,
): Headers {
  const headers = new Headers({
    "cache-control": "no-store, private",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-pumppos-runtime": "supabase-edge",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization,content-type,apikey,trpc-accept,x-branch-id,x-region",
    );
    headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    headers.set("access-control-max-age", "600");
    headers.set("vary", "Origin");
  }
  return headers;
}

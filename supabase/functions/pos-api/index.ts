import "@supabase/functions-js/edge-runtime.d.ts";
import { createBusinessGateway } from "./gateway.ts";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const allowedOrigins = new Set(
  required("ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const catalogReadsEnabled = Deno.env.get("CATALOG_READS_ENABLED") === "true";

const handler = createBusinessGateway({
  appSecret: required("APP_SECRET"),
  upstreamBaseUrl: required("BUSINESS_UPSTREAM_BASE_URL"),
  allowedOrigins,
  // Keep the least-privilege reader behind an explicit rollout switch so a
  // single secret change can route this workload back to Railway.
  catalogDatabaseUrl: catalogReadsEnabled
    ? Deno.env.get("CATALOG_DB_URL")?.trim()
    : undefined,
});

export default {
  fetch: handler,
};

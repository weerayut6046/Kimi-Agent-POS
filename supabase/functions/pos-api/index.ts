import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 240;
const MAX_RATE_LIMIT_BUCKETS = 2_048;
type RateLimitBucket = {
  count: number;
  windowStartedAt: number;
};
const rateLimitBuckets = new Map<string, RateLimitBucket>();
type ApiRuntime = {
  edgeAppRouter: AnyRouter;
  createContext: (opts: FetchCreateContextFnOptions) => Promise<object>;
};
let apiRuntime: Promise<ApiRuntime> | null = null;

function loadApiRuntime(): Promise<ApiRuntime> {
  apiRuntime ??= import("./app.bundle.ts") as Promise<ApiRuntime>;
  return apiRuntime;
}
const allowedOrigins = new Set(
  required("ALLOWED_ORIGINS")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function responseHeaders(origin: string | null): Headers {
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
      "authorization,content-type,apikey,trpc-accept,x-branch-id,x-region"
    );
    headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    headers.set("access-control-max-age", "600");
    headers.set("vary", "Origin");
  }
  return headers;
}

async function requestFingerprint(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(authorization)
    );
    return `token:${Array.from(new Uint8Array(digest).slice(0, 16), byte =>
      byte.toString(16).padStart(2, "0")
    ).join("")}`;
  }
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown";
  return `ip:${address}`;
}

function consumeRequestLimit(key: string, now = Date.now()): number | null {
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      for (const [candidate, value] of rateLimitBuckets) {
        if (now - value.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
          rateLimitBuckets.delete(candidate);
        }
      }
      if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
      }
    }
    rateLimitBuckets.set(key, { count: 1, windowStartedAt: now });
    return null;
  }
  if (bucket.count >= RATE_LIMIT_REQUESTS) {
    return Math.max(
      1,
      Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.windowStartedAt)) / 1_000)
    );
  }
  bucket.count += 1;
  return null;
}

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);
  if (origin && !allowedOrigins.has(origin)) {
    return Response.json(
      { error: { message: "Origin is not allowed" } },
      { status: 403, headers }
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json(
      { error: { message: "Method not allowed" } },
      { status: 405, headers }
    );
  }
  const retryAfter = consumeRequestLimit(await requestFingerprint(request));
  if (retryAfter !== null) {
    headers.set("retry-after", String(retryAfter));
    return Response.json(
      { error: { message: "Too many requests" } },
      { status: 429, headers }
    );
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES) {
    return Response.json(
      { error: { message: "Request is too large" } },
      { status: 413, headers }
    );
  }
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/ping")) {
    headers.set("content-type", "application/json");
    return new Response(
      JSON.stringify({
        result: { data: { json: { ok: true, ts: Date.now() } } },
      }),
      { status: 200, headers }
    );
  }

  let runtime: Awaited<typeof apiRuntime>;
  try {
    runtime = await loadApiRuntime();
  } catch (error) {
    console.error("pos-api runtime initialization failed", error);
    return Response.json(
      {
        error: {
          message: "API runtime initialization failed",
        },
      },
      { status: 500, headers }
    );
  }
  const endpoint = pathname.startsWith("/functions/v1/")
    ? pathname.split("/").slice(0, 4).join("/")
    : pathname.split("/").length > 2
      ? `/${pathname.split("/")[1]}`
      : "";
  const response = await fetchRequestHandler({
    endpoint,
    req: request,
    router: runtime.edgeAppRouter,
    createContext: runtime.createContext,
  });
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
});

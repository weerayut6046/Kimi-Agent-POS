import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import {
  createAllowedOrigins,
  createCorsResponseHeaders,
} from "../pos-api/cors.ts";
import { isCustomerPointsRequestPath, resolveLoyaltyEndpoint } from "./path.ts";

const MAX_REQUEST_BYTES = 32 * 1024;
type ApiRuntime = {
  edgeAppRouter: AnyRouter;
  createContext: (opts: FetchCreateContextFnOptions) => Promise<object>;
};
let apiRuntime: Promise<ApiRuntime> | null = null;

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadApiRuntime(): Promise<ApiRuntime> {
  apiRuntime ??= import("../pos-api/app.bundle.ts") as Promise<ApiRuntime>;
  return apiRuntime;
}

const allowedOrigins = createAllowedOrigins(required("ALLOWED_ORIGINS"));

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  const headers = createCorsResponseHeaders(origin, allowedOrigins);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");

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

  const pathname = new URL(request.url).pathname;
  if (!isCustomerPointsRequestPath(pathname)) {
    return Response.json(
      { error: { message: "Procedure is not available on this endpoint" } },
      { status: 404, headers }
    );
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES) {
    return Response.json(
      { error: { message: "Request is too large" } },
      { status: 413, headers }
    );
  }

  let runtime: Awaited<typeof apiRuntime>;
  try {
    runtime = await loadApiRuntime();
  } catch (error) {
    console.error("pos-loyalty runtime initialization failed", error);
    return Response.json(
      { error: { message: "API runtime initialization failed" } },
      { status: 500, headers }
    );
  }

  const endpoint = resolveLoyaltyEndpoint(pathname);
  const response = await fetchRequestHandler({
    endpoint,
    req: request,
    router: runtime.edgeAppRouter,
    createContext: runtime.createContext,
  });
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
});

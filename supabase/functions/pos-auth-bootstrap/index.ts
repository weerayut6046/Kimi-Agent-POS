import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
);

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "cache-control": "no-store, private",
    pragma: "no-cache",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "content-type,apikey");
    headers.set("access-control-allow-methods", "POST,OPTIONS");
    headers.set("vary", "Origin");
  }
  return headers;
}

Deno.serve(request => {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);

  if (origin && !allowedOrigins.has(origin)) {
    return Response.json(
      { ok: false, error: "FORBIDDEN" },
      { status: 403, headers },
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      { status: 405, headers },
    );
  }

  return Response.json(
    { ok: false, error: "MIGRATION_CLOSED" },
    { status: 410, headers },
  );
});

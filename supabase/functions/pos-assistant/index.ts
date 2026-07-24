import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const supabaseUrl = required("SUPABASE_URL").replace(/\/+$/, "");

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * Compatibility endpoint for older clients. AI now executes inside the main
 * Supabase Edge API; no request is forwarded to Railway.
 */
Deno.serve(request => {
  const target = new URL(
    `${supabaseUrl}/functions/v1/pos-api/assistant.chat`,
  );
  const incoming = new URL(request.url);
  target.search = incoming.search;
  return fetch(target, {
    method: request.method,
    headers: request.headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "error",
  });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() =>
  Response.json(
    { ok: false, error: "STAGING_CLOSED" },
    {
      status: 410,
      headers: {
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    },
  )
);

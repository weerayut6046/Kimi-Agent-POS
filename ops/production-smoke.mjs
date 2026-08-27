const DEFAULT_BASE_URL = "https://kimi-agent-pos.vercel.app";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_MS = 5_000;

const baseUrl = new URL(process.env.SMOKE_BASE_URL?.trim() || DEFAULT_BASE_URL);
const publishableKey =
  process.env.SMOKE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  "";
const requirePublishableKey = /^(1|true|yes)$/i.test(
  process.env.SMOKE_REQUIRE_PUBLISHABLE_KEY?.trim() || ""
);
const timeoutMs = readPositiveInteger("SMOKE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
const maxResponseMs = readPositiveInteger(
  "SMOKE_MAX_RESPONSE_MS",
  DEFAULT_MAX_RESPONSE_MS
);

if (!["http:", "https:"].includes(baseUrl.protocol)) {
  throw new Error("SMOKE_BASE_URL must use http or https");
}

const results = [];
let homeHtml = "";
let homeAssets = [];

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function excerpt(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        "user-agent": "PumpPOS-production-smoke/1.0",
        ...init.headers,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    const durationMs = Math.round(performance.now() - startedAt);
    expect(
      durationMs <= maxResponseMs,
      `response took ${durationMs}ms (limit ${maxResponseMs}ms)`
    );
    return { response, body, durationMs };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, callback) {
  try {
    const detail = await callback();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail: message });
    console.error(`FAIL ${name} - ${message}`);
  }
}

function parseJson(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${excerpt(body)}`);
  }
}

function gatewayHeaders(origin) {
  return {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
    ...(origin ? { origin } : {}),
  };
}

await check("homepage", async () => {
  const { response, body, durationMs } = await request("/");
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(
    response.headers.get("content-type")?.includes("text/html"),
    `unexpected content-type ${response.headers.get("content-type")}`
  );
  expect(/<title>[^<]+<\/title>/i.test(body), "HTML title is missing");
  homeHtml = body;
  homeAssets = [
    ...body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi),
  ].map(match => match[1]);
  expect(homeAssets.length > 0, "no JavaScript or CSS assets found");
  return `200 in ${durationMs}ms`;
});

await check("SPA fallback", async () => {
  const { response, body, durationMs } = await request(
    "/__pump_pos_smoke__/unknown-route"
  );
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(
    response.headers.get("content-type")?.includes("text/html"),
    `unexpected content-type ${response.headers.get("content-type")}`
  );
  expect(
    homeHtml === "" || body.includes("<title>"),
    "SPA fallback did not return the app shell"
  );
  return `200 in ${durationMs}ms`;
});

await check("static assets", async () => {
  const uniqueAssets = [...new Set(homeAssets)].slice(0, 10);
  expect(uniqueAssets.length > 0, "homepage asset list is empty");
  for (const asset of uniqueAssets) {
    const { response, durationMs } = await request(asset);
    expect(
      response.status === 200,
      `${asset} expected 200, got ${response.status}`
    );
    const expectedType = asset.endsWith(".css") ? "text/css" : "javascript";
    expect(
      response.headers.get("content-type")?.includes(expectedType),
      `${asset} has unexpected content-type ${response.headers.get("content-type")}`
    );
    expect(durationMs <= maxResponseMs, `${asset} exceeded response limit`);
  }
  return `${uniqueAssets.length} assets available`;
});

await check("security headers", async () => {
  const { response } = await request("/");
  const csp = response.headers.get("content-security-policy") || "";
  expect(
    csp.includes("object-src 'none'"),
    "CSP object-src is not locked down"
  );
  expect(
    csp.includes("frame-ancestors 'none'"),
    "CSP frame-ancestors is not locked down"
  );
  expect(
    response.headers.get("x-content-type-options") === "nosniff",
    "X-Content-Type-Options is missing"
  );
  expect(
    response.headers.get("referrer-policy") === "no-referrer",
    "Referrer-Policy is missing"
  );
  expect(
    Boolean(response.headers.get("permissions-policy")),
    "Permissions-Policy is missing"
  );
  if (baseUrl.protocol === "https:") {
    expect(
      Boolean(response.headers.get("strict-transport-security")),
      "Strict-Transport-Security is missing"
    );
  }
  return "required headers present";
});

await check("closed auth bootstrap", async () => {
  const { response, body, durationMs } = await request("/api/auth/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const json = parseJson(body, "auth bootstrap");
  expect(response.status === 410, `expected 410, got ${response.status}`);
  expect(
    json.error === "MIGRATION_CLOSED",
    `unexpected body: ${excerpt(body)}`
  );
  return `410 in ${durationMs}ms`;
});

await check("API key required", async () => {
  const { response, body, durationMs } = await request(
    "/api/trpc/ping?input=%7B%7D"
  );
  expect(response.status === 401, `expected 401, got ${response.status}`);
  expect(/UNAUTHORIZED/i.test(body), `unexpected body: ${excerpt(body)}`);
  return `401 in ${durationMs}ms`;
});

if (!publishableKey) {
  const message =
    "SMOKE_SUPABASE_PUBLISHABLE_KEY is not configured; authenticated gateway checks were skipped";
  if (requirePublishableKey) {
    results.push({
      name: "publishable key configured",
      ok: false,
      detail: message,
    });
    console.error(`FAIL publishable key configured - ${message}`);
  } else {
    console.warn(`SKIP ${message}`);
  }
} else {
  await check("API ping", async () => {
    const { response, body, durationMs } = await request(
      "/api/trpc/ping?input=%7B%7D",
      { headers: gatewayHeaders() }
    );
    const json = parseJson(body, "API ping");
    expect(response.status === 200, `expected 200, got ${response.status}`);
    expect(
      json?.result?.data?.json?.ok === true,
      `unexpected body: ${excerpt(body)}`
    );
    return `200 in ${durationMs}ms`;
  });

  await check("CORS allowlist", async () => {
    const blocked = await request("/api/trpc/ping?input=%7B%7D", {
      headers: gatewayHeaders("https://evil.example.com"),
    });
    expect(
      blocked.response.status === 403,
      `disallowed origin expected 403, got ${blocked.response.status}`
    );
    const allowed = await request("/api/trpc/ping?input=%7B%7D", {
      headers: gatewayHeaders(baseUrl.origin),
    });
    expect(
      allowed.response.status === 200,
      `allowed origin expected 200, got ${allowed.response.status}`
    );
    expect(
      allowed.response.headers.get("access-control-allow-origin") ===
        baseUrl.origin,
      "allowed origin was not echoed by CORS"
    );
    return `blocked evil origin; allowed ${baseUrl.origin}`;
  });

  await check("business session required", async () => {
    const procedures = [
      "auth.listBranches",
      "pos.currentShift",
      "catalog.listProducts",
    ];
    for (const procedure of procedures) {
      const { response, body } = await request(`/api/trpc/${procedure}`, {
        headers: gatewayHeaders(),
      });
      expect(
        [401, 403].includes(response.status),
        `${procedure} expected 401/403, got ${response.status}: ${excerpt(body)}`
      );
      expect(!/"result"/i.test(body), `${procedure} returned protected data`);
      expect(
        !/stack|node_modules/i.test(body),
        `${procedure} leaked internals`
      );
    }
    return `${procedures.length} protected procedures rejected`;
  });

  await check("unsupported API method", async () => {
    const { response, durationMs } = await request("/api/trpc/ping", {
      method: "DELETE",
      headers: gatewayHeaders(),
    });
    expect(response.status === 405, `expected 405, got ${response.status}`);
    return `405 in ${durationMs}ms`;
  });

  await check("unknown procedure hygiene", async () => {
    const { response, body, durationMs } = await request(
      "/api/trpc/no.suchProcedure",
      { headers: gatewayHeaders() }
    );
    expect(
      [400, 404].includes(response.status),
      `expected 400/404, got ${response.status}`
    );
    expect(!/stack|node_modules/i.test(body), "response leaked internals");
    return `${response.status} in ${durationMs}ms`;
  });
}

const failed = results.filter(result => !result.ok);
console.log(
  `\nProduction smoke summary: ${results.length - failed.length}/${results.length} passed for ${baseUrl.origin}`
);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`- ${result.name}: ${result.detail}`);
  }
  process.exitCode = 1;
}

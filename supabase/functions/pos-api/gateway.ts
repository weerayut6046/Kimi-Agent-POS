type StaffSessionClaims = {
  id: number;
  name: string;
  role: "admin" | "manager" | "cashier";
  username: string;
  exp: number;
};

type RateWindow = { startedAt: number; count: number };

export type BusinessGatewayConfig = {
  appSecret: string;
  upstreamBaseUrl: string;
  allowedOrigins: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  loginRequestsPerMinute?: number;
  upstreamTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
};

const SESSION_HEADER = "x-staff-session";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_LOGIN_IDENTITIES = 5_000;
const encoder = new TextEncoder();

const ANONYMOUS_PROCEDURES = new Set([
  "ping",
  "auth.login",
  "auth.currentStaff",
  "catalog.lanInfo",
]);

const BUSINESS_PREFIXES = [
  "auth.",
  "catalog.",
  "pos.",
  "membership.",
  "taxInvoice.",
  "customers.",
  "credit.",
  "expenses.",
  "reports.",
  "audit.",
  "workforce.",
];

// These responses can contain multi-megabyte binary data encoded as base64.
// They stay on the Railway worker until they are moved to Supabase Storage.
const EDGE_EXCLUDED_PROCEDURES = new Set([
  "reports.exportDailyExcel",
  "reports.exportRangeExcel",
]);

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const decoded = atob(padded);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function base64UrlText(value: string): string {
  return new TextDecoder().decode(base64UrlBytes(value));
}

async function verifyStaffSession(
  token: string,
  secret: string,
  nowSeconds: number
): Promise<StaffSessionClaims | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlBytes(signature),
      encoder.encode(payload)
    );
    if (!valid) return null;
    const claims = JSON.parse(
      base64UrlText(payload)
    ) as Partial<StaffSessionClaims>;
    if (
      !Number.isInteger(claims.id) ||
      Number(claims.id) <= 0 ||
      typeof claims.name !== "string" ||
      typeof claims.username !== "string" ||
      !["admin", "manager", "cashier"].includes(String(claims.role)) ||
      !Number.isFinite(claims.exp) ||
      Number(claims.exp) <= nowSeconds
    ) {
      return null;
    }
    return claims as StaffSessionClaims;
  } catch {
    return null;
  }
}

function securityHeaders(origin: string | null, allowed: boolean): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, private",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-PumpPOS-Gateway": "supabase-edge",
  });
  if (origin && allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "accept,content-type,trpc-accept,x-staff-session"
    );
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
  }
  return headers;
}

function trpcError(
  status: number,
  code: string,
  message: string,
  headers: Headers
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(
    {
      error: {
        json: {
          message,
          code: -32000,
          data: { code, httpStatus: status },
        },
      },
    },
    { status, headers: responseHeaders }
  );
}

function procedureFromUrl(url: URL): string | null {
  const marker = ["/functions/v1/pos-api/", "/pos-api/"].find(candidate =>
    url.pathname.startsWith(candidate)
  );
  if (!marker) return null;
  let procedure: string;
  try {
    procedure = decodeURIComponent(url.pathname.slice(marker.length));
  } catch {
    return null;
  }
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,120}$/.test(procedure)) return null;
  if (EDGE_EXCLUDED_PROCEDURES.has(procedure)) return null;
  if (ANONYMOUS_PROCEDURES.has(procedure)) return procedure;
  return BUSINESS_PREFIXES.some(prefix => procedure.startsWith(prefix))
    ? procedure
    : null;
}

async function requestIdentity(request: Request): Promise<string> {
  // Do not trust the client-controlled x-forwarded-for chain. Supabase/Vercel
  // overwrite these platform headers at the edge; using only the first trusted
  // address prevents a caller from rotating arbitrary values to evade the
  // login limiter. The upstream worker still applies its own account limits.
  const raw =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function createBusinessGateway(config: BusinessGatewayConfig) {
  if (!config.appSecret || config.appSecret.length < 32) {
    throw new Error("APP_SECRET must contain at least 32 characters");
  }
  const upstreamBase = new URL(config.upstreamBaseUrl);
  if (
    upstreamBase.protocol !== "https:" ||
    !upstreamBase.pathname.endsWith("/api/trpc/")
  ) {
    throw new Error(
      "BUSINESS_UPSTREAM_BASE_URL must be an HTTPS tRPC base URL"
    );
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const loginLimit = config.loginRequestsPerMinute ?? 10;
  const timeoutMs = config.upstreamTimeoutMs ?? 55_000;
  const maxRequestBytes = config.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const maxResponseBytes = config.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const loginWindows = new Map<string, RateWindow>();

  return async function businessGateway(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const originAllowed = !origin || config.allowedOrigins.has(origin);
    const headers = securityHeaders(origin, originAllowed);
    const errorResponse = (status: number, code: string, message: string) =>
      trpcError(status, code, message, headers);

    if (request.method === "OPTIONS") {
      if (!origin || !originAllowed) {
        return new Response(null, { status: 403, headers });
      }
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_SUPPORTED", "Method not allowed");
    }
    if (!originAllowed) {
      return errorResponse(403, "FORBIDDEN", "Origin is not allowed");
    }

    const url = new URL(request.url);
    const procedure = procedureFromUrl(url);
    if (!procedure) {
      return errorResponse(404, "NOT_FOUND", "Procedure is not available");
    }

    const token = request.headers.get(SESSION_HEADER) ?? "";
    const claims = await verifyStaffSession(
      token,
      config.appSecret,
      Math.floor(now() / 1_000)
    );
    if (!ANONYMOUS_PROCEDURES.has(procedure) && !claims) {
      return errorResponse(401, "UNAUTHORIZED", "Session expired");
    }

    if (procedure === "auth.login") {
      let identity = await requestIdentity(request);
      const currentTime = now();
      if (
        !loginWindows.has(identity) &&
        loginWindows.size >= MAX_LOGIN_IDENTITIES
      ) {
        for (const [key, candidate] of loginWindows) {
          if (currentTime - candidate.startedAt >= 60_000)
            loginWindows.delete(key);
        }
        if (loginWindows.size >= MAX_LOGIN_IDENTITIES) identity = "overflow";
      }
      const window = loginWindows.get(identity);
      if (!window || currentTime - window.startedAt >= 60_000) {
        loginWindows.set(identity, { startedAt: currentTime, count: 1 });
      } else {
        window.count += 1;
        if (window.count > loginLimit) {
          return errorResponse(
            429,
            "TOO_MANY_REQUESTS",
            "Too many login attempts"
          );
        }
      }
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxRequestBytes) {
      return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large");
    }
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (request.method === "POST") {
      body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > maxRequestBytes) {
        return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large");
      }
    }

    const upstream = new URL(procedure, upstreamBase);
    upstream.search = url.search;
    const forwardedHeaders = new Headers({
      Accept: request.headers.get("accept") ?? "application/json",
    });
    const contentType = request.headers.get("content-type");
    if (contentType) forwardedHeaders.set("Content-Type", contentType);
    const trpcAccept = request.headers.get("trpc-accept");
    if (trpcAccept) forwardedHeaders.set("trpc-accept", trpcAccept);
    if (token) forwardedHeaders.set(SESSION_HEADER, token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(upstream, {
        method: request.method,
        headers: forwardedHeaders,
        body,
        redirect: "error",
        signal: controller.signal,
      });
      const responseBody = new Uint8Array(await response.arrayBuffer());
      if (responseBody.byteLength > maxResponseBytes) {
        return errorResponse(502, "BAD_GATEWAY", "Response is too large");
      }
      const responseHeaders = securityHeaders(origin, originAllowed);
      responseHeaders.set(
        "Content-Type",
        response.headers.get("content-type") ??
          "application/json; charset=utf-8"
      );
      return new Response(responseBody, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return errorResponse(504, "TIMEOUT", "Upstream timed out");
      }
      return errorResponse(502, "BAD_GATEWAY", "Upstream unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}

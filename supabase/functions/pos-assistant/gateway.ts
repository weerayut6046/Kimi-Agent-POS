type StaffSessionClaims = {
  id: number;
  name: string;
  role: "admin" | "manager" | "cashier";
  username: string;
  exp: number;
};

type RateWindow = { startedAt: number; count: number };

export type AssistantGatewayConfig = {
  appSecret: string;
  upstreamUrl: string;
  allowedOrigins: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxRequestsPerMinute?: number;
  upstreamTimeoutMs?: number;
};

const SESSION_HEADER = "x-staff-session";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_CONVERSATION_CHARS = 12_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;

const encoder = new TextEncoder();

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

function trpcError(
  status: number,
  code: string,
  message: string,
  responseHeaders: Headers
): Response {
  const headers = new Headers(responseHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
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
    { status, headers }
  );
}

function isValidChatBody(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const json = (value as { json?: unknown }).json;
  if (!json || typeof json !== "object") return false;
  const messages = (json as { messages?: unknown }).messages;
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > MAX_MESSAGES
  ) {
    return false;
  }
  const validMessages = messages.every(message => {
    if (!message || typeof message !== "object") return false;
    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    return (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.length >= 1 &&
      content.length <= MAX_MESSAGE_CHARS
    );
  });
  if (!validMessages) return false;
  if ((messages.at(-1) as { role?: unknown }).role !== "user") return false;
  return (
    messages.reduce(
      (total, message) =>
        total + ((message as { content: string }).content?.length ?? 0),
      0
    ) <= MAX_CONVERSATION_CHARS
  );
}

function securityHeaders(origin: string | null, allowed: boolean): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "content-type,x-staff-session");
    headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function createAssistantGateway(config: AssistantGatewayConfig) {
  if (!config.appSecret || config.appSecret.length < 32) {
    throw new Error("APP_SECRET must contain at least 32 characters");
  }
  const upstream = new URL(config.upstreamUrl);
  if (upstream.protocol !== "https:") {
    throw new Error("ASSISTANT_UPSTREAM_URL must use HTTPS");
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const limit = config.maxRequestsPerMinute ?? 8;
  const timeoutMs = config.upstreamTimeoutMs ?? 35_000;
  const rateWindows = new Map<number, RateWindow>();

  return async function assistantGateway(request: Request): Promise<Response> {
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
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers,
      });
    }
    if (!originAllowed) {
      return errorResponse(403, "FORBIDDEN", "Origin ไม่ได้รับอนุญาต");
    }

    const token = request.headers.get(SESSION_HEADER) ?? "";
    const claims = await verifyStaffSession(
      token,
      config.appSecret,
      Math.floor(now() / 1_000)
    );
    if (!claims) {
      return errorResponse(401, "UNAUTHORIZED", "เซสชันหมดอายุ");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return errorResponse(413, "PAYLOAD_TOO_LARGE", "ข้อความยาวเกินกำหนด");
    }
    const bodyText = await request.text();
    if (encoder.encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "PAYLOAD_TOO_LARGE", "ข้อความยาวเกินกำหนด");
    }
    try {
      if (!isValidChatBody(JSON.parse(bodyText))) {
        return errorResponse(400, "BAD_REQUEST", "รูปแบบข้อความไม่ถูกต้อง");
      }
    } catch {
      return errorResponse(400, "BAD_REQUEST", "รูปแบบ JSON ไม่ถูกต้อง");
    }

    const currentTime = now();
    const currentWindow = rateWindows.get(claims.id);
    if (!currentWindow || currentTime - currentWindow.startedAt >= 60_000) {
      rateWindows.set(claims.id, { startedAt: currentTime, count: 1 });
    } else {
      currentWindow.count += 1;
      if (currentWindow.count > limit) {
        return errorResponse(
          429,
          "TOO_MANY_REQUESTS",
          "ส่งข้อความถี่เกินไป กรุณารอสักครู่"
        );
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(upstream, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [SESSION_HEADER]: token,
        },
        body: bodyText,
        redirect: "error",
        signal: controller.signal,
      });
      const responseBody = new Uint8Array(await response.arrayBuffer());
      if (responseBody.byteLength > MAX_UPSTREAM_RESPONSE_BYTES) {
        return errorResponse(502, "BAD_GATEWAY", "คำตอบจาก AI มีขนาดผิดปกติ");
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
        return errorResponse(
          504,
          "TIMEOUT",
          "AI ใช้เวลาตอบนานเกินไป กรุณาลองใหม่"
        );
      }
      return errorResponse(502, "BAD_GATEWAY", "AI ยังไม่พร้อมใช้งานชั่วคราว");
    } finally {
      clearTimeout(timer);
    }
  };
}

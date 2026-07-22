import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAssistantGateway } from "./gateway.ts";

const APP_SECRET = "0123456789abcdef0123456789abcdef";
const ALLOWED_ORIGIN = "https://kimi-agent-pos.vercel.app";
const UPSTREAM_URL =
  "https://api-production-dc37.up.railway.app/api/trpc/assistant.chat";
const NOW = 1_800_000_000_000;

function sessionToken(exp = Math.floor(NOW / 1_000) + 300): string {
  const payload = Buffer.from(
    JSON.stringify({
      id: 7,
      name: "Admin",
      role: "admin",
      username: "admin",
      exp,
    })
  ).toString("base64url");
  const signature = createHmac("sha256", APP_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function chatBody(content = "ตรวจสอบสต๊อกน้ำมัน") {
  return JSON.stringify({
    json: { messages: [{ role: "user", content }] },
  });
}

function request(
  token = sessionToken(),
  body = chatBody(),
  extraHeaders: HeadersInit = {}
): Request {
  return new Request("https://example.supabase.co/functions/v1/pos-assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
      "x-staff-session": token,
      ...extraHeaders,
    },
    body,
  });
}

function gateway(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createAssistantGateway>[0]> = {}
) {
  return createAssistantGateway({
    appSecret: APP_SECRET,
    upstreamUrl: UPSTREAM_URL,
    allowedOrigins: new Set([ALLOWED_ORIGIN]),
    fetchImpl,
    now: () => NOW,
    ...overrides,
  });
}

describe("Supabase assistant gateway", () => {
  it("forwards a valid signed request without browser credentials", async () => {
    const upstreamBody = JSON.stringify({
      result: { data: { json: { answer: "พร้อมใช้งาน" } } },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(upstreamBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    ) as unknown as typeof fetch;
    const handler = gateway(fetchMock);
    const token = sessionToken();

    const response = await handler(
      request(token, chatBody(), {
        Authorization: "Bearer must-not-forward",
        Cookie: "session=must-not-forward",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(upstreamBody);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      ALLOWED_ORIGIN
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(UPSTREAM_URL);
    expect(init.body).toBe(chatBody());
    const forwardedHeaders = new Headers(init.headers);
    expect(forwardedHeaders.get("x-staff-session")).toBe(token);
    expect(forwardedHeaders.has("authorization")).toBe(false);
    expect(forwardedHeaders.has("cookie")).toBe(false);
  });

  it("rejects missing, tampered, and expired staff sessions", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const handler = gateway(fetchMock);
    const valid = sessionToken();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const expired = sessionToken(Math.floor(NOW / 1_000) - 1);

    for (const token of ["", tampered, expired]) {
      const response = await handler(request(token));
      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        ALLOWED_ORIGIN
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows preflight only from the configured production origin", async () => {
    const handler = gateway(vi.fn() as unknown as typeof fetch);
    const allowed = await handler(
      new Request("https://example.supabase.co/functions/v1/pos-assistant", {
        method: "OPTIONS",
        headers: { Origin: ALLOWED_ORIGIN },
      })
    );
    const denied = await handler(
      new Request("https://example.supabase.co/functions/v1/pos-assistant", {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      })
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      ALLOWED_ORIGIN
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("rejects untrusted browser origins before checking the session", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const handler = gateway(fetchMock);
    const response = await handler(
      request(sessionToken(), chatBody(), {
        Origin: "https://attacker.example",
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the same chat schema limits as the Railway API", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const handler = gateway(fetchMock);
    const invalidBodies = [
      "not-json",
      JSON.stringify({ json: { messages: [] } }),
      JSON.stringify({
        json: { messages: [{ role: "assistant", content: "last message" }] },
      }),
      chatBody("x".repeat(2_001)),
      JSON.stringify({
        json: {
          messages: Array.from({ length: 13 }, () => ({
            role: "user",
            content: "x",
          })),
        },
      }),
    ];

    for (const body of invalidBodies) {
      const response = await handler(request(sessionToken(), body));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects request bodies over 64 KiB before reading them", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const handler = gateway(fetchMock);
    const response = await handler(
      request(sessionToken(), chatBody(), { "Content-Length": "65537" })
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits each staff account independently", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true })
    ) as unknown as typeof fetch;
    const handler = gateway(fetchMock, { maxRequestsPerMinute: 2 });

    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    const limited = await handler(request());

    expect(limited.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an upstream request that exceeds the configured deadline", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;
    const handler = gateway(fetchImpl, { upstreamTimeoutMs: 5 });

    const response = await handler(request());

    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

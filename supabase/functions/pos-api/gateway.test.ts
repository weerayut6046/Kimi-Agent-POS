import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CatalogReadResult } from "./catalog.ts";
import { createBusinessGateway } from "./gateway.ts";

const APP_SECRET = "0123456789abcdef0123456789abcdef";
const ALLOWED_ORIGIN = "https://kimi-agent-pos.vercel.app";
const UPSTREAM_BASE = "https://api-production-dc37.up.railway.app/api/trpc/";
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

function edgeRequest(
  procedure: string,
  options: {
    method?: string;
    token?: string | null;
    origin?: string | null;
    body?: string;
    headers?: HeadersInit;
    query?: string;
  } = {}
): Request {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? ALLOWED_ORIGIN);
  }
  if (options.token !== null) {
    headers.set("x-staff-session", options.token ?? sessionToken());
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(
    `https://example.supabase.co/functions/v1/pos-api/${procedure}${options.query ?? ""}`,
    {
      method,
      headers,
      body: options.body,
    }
  );
}

function gateway(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createBusinessGateway>[0]> = {}
) {
  return createBusinessGateway({
    appSecret: APP_SECRET,
    upstreamBaseUrl: UPSTREAM_BASE,
    allowedOrigins: new Set([ALLOWED_ORIGIN]),
    fetchImpl,
    now: () => NOW,
    ...overrides,
  });
}

function okFetch(body = '{"result":{"data":{"json":{"ok":true}}}}') {
  return vi.fn(
    async () =>
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

function catalogReader(
  overrides: Partial<CatalogReadResult> = {}
): CatalogReadResult {
  return {
    isActiveStaff: vi.fn(async () => true),
    listProducts: vi.fn(async () => []),
    listPumps: vi.fn(async () => []),
    listTanks: vi.fn(async () => []),
    listRefills: vi.fn(async () => []),
    lowStockAlerts: vi.fn(async () => ({
      lowTanks: [],
      lowProducts: [],
      count: 0,
    })),
    priceHistory: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    getShopLogo: vi.fn(async () => null),
    ...overrides,
  };
}

describe("Supabase business API gateway", () => {
  it("forwards an authenticated request and only the approved headers", async () => {
    const fetchMock = okFetch();
    const handler = gateway(fetchMock);
    const token = sessionToken();
    const response = await handler(
      edgeRequest("pos.dashboard", {
        method: "POST",
        token,
        query: "?batch=1",
        body: '{"json":{"date":"2026-07-22"}}',
        headers: {
          Accept: "application/json",
          Authorization: "Bearer must-not-forward",
          Cookie: "private=cookie",
          "trpc-accept": "application/jsonl",
          "x-private-header": "must-not-forward",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-pumppos-gateway")).toBe("supabase-edge");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`${UPSTREAM_BASE}pos.dashboard?batch=1`);
    const forwarded = new Headers(init.headers);
    expect(forwarded.get("x-staff-session")).toBe(token);
    expect(forwarded.get("trpc-accept")).toBe("application/jsonl");
    expect(forwarded.has("authorization")).toBe(false);
    expect(forwarded.has("cookie")).toBe(false);
    expect(forwarded.has("x-private-header")).toBe(false);
  });

  it("accepts the normalized path supplied by the hosted Edge runtime", async () => {
    const fetchMock = okFetch();
    const response = await gateway(fetchMock)(
      new Request("https://example.supabase.co/pos-api/catalog.listTanks", {
        headers: {
          Origin: ALLOWED_ORIGIN,
          "x-staff-session": sessionToken(),
        },
      })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("serves migrated stock reads from Supabase after a fresh staff check", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader({
      isActiveStaff: vi.fn(
        async staff =>
          staff.id === 7 && staff.username === "admin" && staff.role === "admin"
      ),
      lowStockAlerts: vi.fn(async () => ({
        lowTanks: [],
        lowProducts: [],
        count: 0,
      })),
    });
    const response = await gateway(fetchMock, { catalogReader: reader })(
      edgeRequest("catalog.lowStockAlerts")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { data: { json: { lowTanks: [], lowProducts: [], count: 0 } } },
    });
    expect(reader.isActiveStaff).toHaveBeenCalledWith({
      id: 7,
      username: "admin",
      role: "admin",
    });
    expect(reader.lowStockAlerts).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves migrated product reads from Supabase", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader({
      listProducts: vi.fn(async () => [{ id: 1, code: "GSH95" }]),
    });
    const response = await gateway(fetchMock, { catalogReader: reader })(
      edgeRequest("catalog.listProducts")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-pumppos-data-source")).toBe(
      "supabase-postgres"
    );
    await expect(response.json()).resolves.toEqual({
      result: { data: { json: [{ id: 1, code: "GSH95" }] } },
    });
    expect(reader.listProducts).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates and serves migrated price history reads", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader({
      priceHistory: vi.fn(async (productId: number) => [{ productId }]),
    });
    const query = `?input=${encodeURIComponent(
      JSON.stringify({
        json: { productId: 12 },
      })
    )}`;
    const response = await gateway(fetchMock, { catalogReader: reader })(
      edgeRequest("catalog.priceHistory", { query })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { data: { json: [{ productId: 12 }] } },
    });
    expect(reader.priceHistory).toHaveBeenCalledWith(12);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed migrated price history input", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader();
    const response = await gateway(fetchMock, { catalogReader: reader })(
      edgeRequest("catalog.priceHistory", {
        query: `?input=${encodeURIComponent(
          JSON.stringify({
            json: { productId: -1 },
          })
        )}`,
      })
    );

    expect(response.status).toBe(400);
    expect(reader.priceHistory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the migrated catalog staff check is stale", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader({
      isActiveStaff: vi.fn(async () => false),
    });
    const response = await gateway(fetchMock, { catalogReader: reader })(
      edgeRequest("catalog.listTanks")
    );

    expect(response.status).toBe(401);
    expect(reader.listTanks).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the next read-only catalog batch from Supabase", async () => {
    const fetchMock = okFetch();
    const reader = catalogReader({
      listPumps: vi.fn(async () => [{ id: 1, nozzles: [] }]),
      listRefills: vi.fn(async () => [{ id: 2, tankId: 1 }]),
      getSettings: vi.fn(async () => ({ shop_name: "Station" })),
      getShopLogo: vi.fn(async () => "data:image/png;base64,abc"),
    });
    const cases = [
      ["catalog.listPumps", "listPumps"],
      ["catalog.listRefills", "listRefills"],
      ["catalog.getSettings", "getSettings"],
      ["catalog.getShopLogo", "getShopLogo"],
    ] as const;

    for (const [procedure, method] of cases) {
      const response = await gateway(fetchMock, { catalogReader: reader })(
        edgeRequest(procedure)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("x-pumppos-data-source")).toBe(
        "supabase-postgres"
      );
      expect(reader[method]).toHaveBeenCalledOnce();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["tampered", `${sessionToken()}x`],
    ["expired", sessionToken(Math.floor(NOW / 1_000) - 1)],
  ])(
    "rejects a %s session before contacting the worker",
    async (_name, token) => {
      const fetchMock = okFetch();
      const response = await gateway(fetchMock)(
        edgeRequest("catalog.listTanks", { token })
      );
      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["ping", "auth.login", "auth.currentStaff", "catalog.lanInfo"])(
    "allows the pre-login procedure %s without a session",
    async procedure => {
      const fetchMock = okFetch();
      const response = await gateway(fetchMock)(
        edgeRequest(procedure, { token: null })
      );
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );

  it("rejects an untrusted browser origin and handles trusted preflight", async () => {
    const fetchMock = okFetch();
    const handler = gateway(fetchMock);
    const rejected = await handler(
      edgeRequest("ping", {
        token: null,
        origin: "https://attacker.example",
      })
    );
    const preflight = await handler(
      edgeRequest("ping", {
        method: "OPTIONS",
        token: null,
      })
    );
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has("access-control-allow-origin")).toBe(false);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      ALLOWED_ORIGIN
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "assistant.chat",
    "dbadmin.readBackup",
    "reports.exportDailyExcel",
    "reports.exportRangeExcel",
    "unknown.read",
    "pos%2Fcreate",
  ])("does not expose the excluded procedure %s", async procedure => {
    const fetchMock = okFetch();
    const response = await gateway(fetchMock)(edgeRequest(procedure));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the request size from both content-length and actual bytes", async () => {
    const fetchMock = okFetch();
    const handler = gateway(fetchMock, { maxRequestBytes: 4 });
    const declared = await handler(
      edgeRequest("pos.createSale", {
        method: "POST",
        headers: { "Content-Length": "5" },
        body: "{}",
      })
    );
    const actual = await handler(
      edgeRequest("pos.createSale", {
        method: "POST",
        body: "12345",
      })
    );
    expect(declared.status).toBe(413);
    expect(actual.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized upstream response", async () => {
    const fetchMock = okFetch("12345");
    const response = await gateway(fetchMock, { maxResponseBytes: 4 })(
      edgeRequest("catalog.listProducts")
    );
    expect(response.status).toBe(502);
    await expect(response.text()).resolves.not.toContain("12345");
  });

  it("rate limits login attempts by a non-reversible client identity", async () => {
    const fetchMock = okFetch();
    const handler = gateway(fetchMock, { loginRequestsPerMinute: 2 });
    const requestLogin = () =>
      handler(
        edgeRequest("auth.login", {
          method: "POST",
          token: null,
          body: '{"json":{"username":"admin","pin":"0000"}}',
          headers: { "cf-connecting-ip": "203.0.113.8" },
        })
      );

    expect((await requestLogin()).status).toBe(200);
    expect((await requestLogin()).status).toBe(200);
    expect((await requestLogin()).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a sanitized timeout without leaking the upstream error", async () => {
    const fetchMock = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("secret upstream detail", "AbortError"));
          });
        })
    ) as unknown as typeof fetch;
    const response = await gateway(fetchMock, { upstreamTimeoutMs: 1 })(
      edgeRequest("catalog.listTanks")
    );
    expect(response.status).toBe(504);
    await expect(response.text()).resolves.not.toContain(
      "secret upstream detail"
    );
  });

  it("refuses unsafe configuration and unsupported methods", async () => {
    expect(() =>
      createBusinessGateway({
        appSecret: "short",
        upstreamBaseUrl: UPSTREAM_BASE,
        allowedOrigins: new Set(),
      })
    ).toThrow(/APP_SECRET/);
    expect(() =>
      createBusinessGateway({
        appSecret: APP_SECRET,
        upstreamBaseUrl: "http://internal.example/api/trpc/",
        allowedOrigins: new Set(),
      })
    ).toThrow(/HTTPS/);

    const response = await gateway(okFetch())(
      edgeRequest("ping", { method: "DELETE", token: null })
    );
    expect(response.status).toBe(405);
  });
});

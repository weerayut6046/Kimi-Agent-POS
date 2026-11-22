import { createHash } from "node:crypto";
import fs from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopSaleRequest } from "../../web/contracts/offline";
import { DesktopOfflineRuntime } from "./offlineRuntime";

const remoteOrigin = "https://business.example.test";
const directories: string[] = [];
const runtimes: DesktopOfflineRuntime[] = [];
const statusPaths = [
  "/api/trpc/initialSetup.state",
  "/api/trpc/catalog.listProducts,initialSetup.state?batch=1",
  "/api/trpc/initialSetup.state%2Ccatalog.listProducts?batch=1",
  "/api/%74rpc/%69nitialSetup%2Estate",
];
const catalogPath = "/api/trpc/catalog.listProducts";
const sale: DesktopSaleRequest = {
  staffToken: "existing-staff-session",
  input: {
    staffName: "Cashier",
    items: [{ productId: 1, qty: 1 }],
    discount: 0,
    paymentMethod: "cash",
    received: 20,
    pointsToRedeem: 0,
  },
  lines: [
    {
      productId: 1,
      name: "Water",
      unit: "bottle",
      unitPrice: 10,
      category: "other",
      qty: 1,
    },
  ],
  context: {
    vatRate: 7,
    pointEarnPerBaht: 100,
    pointRedeemValue: 1,
    promotionActive: false,
    memberName: null,
    customerName: null,
  },
};

function tempDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pos-initial-setup-test-")
  );
  directories.push(directory);
  return directory;
}

function runtime(dataDir = tempDirectory()) {
  const instance = new DesktopOfflineRuntime({
    dataDir,
    staticDir: dataDir,
    remoteOrigin,
  });
  runtimes.push(instance);
  return instance;
}

function cacheKey(method: string, requestPath: string, body = "") {
  const url = new URL(requestPath, "http://127.0.0.1");
  return createHash("sha256")
    .update(method)
    .update("\0")
    .update(url.pathname)
    .update(url.search)
    .update("\0")
    .update(body)
    .update("\0")
    .update("")
    .digest("hex");
}

function cached(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
    storedAt: new Date().toISOString(),
  };
}

function authorization(sub = "staff-a", exp = Math.floor(Date.now() / 1000) + 600) {
  const claims = Buffer.from(JSON.stringify({ sub, exp })).toString("base64url");
  return `Bearer header.${claims}.signature`;
}

const result = (json: unknown) => ({ result: { data: { json } } });

function localRequest(
  url: string,
  method = "GET",
  body = "",
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          })
        );
        response.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

afterEach(() => {
  for (const instance of runtimes.splice(0)) instance.stop();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("desktop initial setup requires authoritative online responses", () => {
  it("forwards setup only from its own loopback page without broadening cloud origins", async () => {
    const calls: Array<{ url: string; headers: Headers; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          headers: new Headers(init?.headers),
          body: init?.body,
        });
        return Response.json({ ok: true });
      })
    );
    const instance = runtime();
    const localUrl = await instance.start();
    const target = `${localUrl}/api/trpc/initialSetup.createOwner`;
    const body = JSON.stringify({
      json: { installationCode: "private-proof", pin: "6789" },
    });
    expect(
      (
        await localRequest(target, "POST", body, {
          origin: localUrl,
          referer: `${localUrl}/setup`,
          apikey: "publishable-project-key",
        })
      ).status
    ).toBe(200);
    const forwarded = calls.filter(call =>
      call.url.includes("initialSetup.createOwner")
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].headers.has("origin")).toBe(false);
    expect(forwarded[0].headers.has("referer")).toBe(false);
    expect(forwarded[0].headers.get("apikey")).toBe("publishable-project-key");
    expect(String(forwarded[0].body)).toBe(body);
    expect(
      (
        await localRequest(target, "POST", body, {
          origin: "https://foreign.example",
          referer: `${localUrl}/setup`,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await localRequest(target, "POST", body, {
          origin: localUrl,
          referer: "https://foreign.example/setup",
        })
      ).status
    ).toBe(403);
    expect(
      calls.filter(call => call.url.includes("initialSetup.createOwner"))
    ).toHaveLength(1);
  });
  it("forwards live setup status without caching it, including mixed batches, while preserving other query caches", async () => {
    let online = true;
    let status = "unclaimed";
    const remoteFetch = vi.fn(async (url: string | URL | Request) => {
      if (!online) throw new Error("offline");
      if (
        decodeURIComponent(new URL(String(url)).pathname).includes(
          "initialSetup.state"
        )
      )
        return Response.json({ status });
      if (String(url).includes("catalog.listProducts"))
        return Response.json(result([{ name: "existing-catalog", cost: 80 }]));
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", remoteFetch);
    const dataDir = tempDirectory();
    const instance = runtime(dataDir);
    const localUrl = await instance.start();
    for (const requestPath of statusPaths) {
      const response = await localRequest(`${localUrl}${requestPath}`);
      expect(response.body).toContain("unclaimed");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    status = "claimed";
    expect((await localRequest(`${localUrl}${statusPaths[0]}`)).body).toContain(
      "claimed"
    );
    const credential = { authorization: authorization(), "x-branch-id": "1" };
    await localRequest(`${localUrl}${catalogPath}`, "GET", "", credential);
    const stored = JSON.parse(
      fs.readFileSync(path.join(dataDir, "desktop-offline-state.json"), "utf8")
    );
    expect(Object.keys(stored.cache)).toHaveLength(1);

    online = false;
    for (const requestPath of statusPaths) {
      const response = await localRequest(`${localUrl}${requestPath}`);
      expect(response.status).toBe(503);
      expect(response.headers["x-pos-offline-cache"]).toBeUndefined();
      expect(response.body).not.toContain("unclaimed");
    }
    const catalog = await localRequest(`${localUrl}${catalogPath}`, "GET", "", credential);
    expect(catalog.status).toBe(200);
    expect(catalog.headers["x-pos-offline-cache"]).toBe("1");
    expect(catalog.body).toContain("existing-catalog");
    expect(catalog.body).toContain('"cost":0');
    expect(instance.getStatus().pendingCount).toBe(0);
  });

  it("drops older unscoped caches including stale installation status", async () => {
    const dataDir = tempDirectory();
    const cache = Object.fromEntries(
      statusPaths.map(requestPath => [
        cacheKey("GET", requestPath),
        cached({ status: "unclaimed", oldInstallation: true }),
      ])
    );
    cache[cacheKey("GET", catalogPath)] = cached({
      products: ["preserved-catalog"],
    });
    fs.writeFileSync(
      path.join(dataDir, "desktop-offline-state.json"),
      JSON.stringify({
        version: 1,
        remoteOrigin,
        deviceId: "legacy-device",
        receiptCounter: 0,
        queue: [],
        cache,
        lastSyncedAt: null,
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const instance = runtime(dataDir);
    const localUrl = await instance.start();
    for (const requestPath of statusPaths) {
      const response = await localRequest(`${localUrl}${requestPath}`);
      expect(response.status).toBe(503);
      expect(response.body).not.toContain("oldInstallation");
      expect(response.headers["x-pos-offline-cache"]).toBeUndefined();
    }
    const catalog = await localRequest(`${localUrl}${catalogPath}`, "GET", "", { authorization: authorization() });
    expect(catalog.status).toBe(503);
    expect(catalog.body).not.toContain("preserved-catalog");
    const state = JSON.parse(fs.readFileSync(path.join(dataDir, "desktop-offline-state.json"), "utf8"));
    expect(state.cache).toEqual({});
  });

  it("never queues first-owner writes or reuses cached owner results when offline, preserving pending sales", async () => {
    const dataDir = tempDirectory();
    const source = runtime(dataDir);
    await source.createSale(sale);
    const stateFile = path.join(dataDir, "desktop-offline-state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const ownerInput = JSON.stringify({
      json: {
        username: "new-owner",
        name: "New owner",
        pin: "6789",
        installationProof: "one-time-installation-proof",
      },
    });
    const writePaths = [
      "/api/trpc/initialSetup.createOwner",
      "/api/trpc/initialSetup.createOwner,catalog.updateProduct?batch=1",
    ];
    for (const requestPath of writePaths)
      state.cache[cacheKey("POST", requestPath, ownerInput)] = cached({
        owner: "cached-owner-result",
      });
    fs.writeFileSync(stateFile, JSON.stringify(state));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const instance = runtime(dataDir);
    const localUrl = await instance.start();
    for (const requestPath of writePaths) {
      const response = await localRequest(
        `${localUrl}${requestPath}`,
        "POST",
        ownerInput
      );
      expect(response.status).toBe(503);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-pos-offline-cache"]).toBeUndefined();
      expect(response.body).not.toContain("cached-owner-result");
    }
    expect(instance.getStatus().pendingCount).toBe(1);
    const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    expect(after.queue).toHaveLength(1);
    expect(after.queue[0].remoteInput).toEqual(state.queue[0].remoteInput);
    expect(JSON.stringify(after)).not.toContain("one-time-installation-proof");
    expect(JSON.stringify(after.queue)).not.toContain("new-owner");
  });
});

describe("desktop offline authorization scope", () => {
  it("isolates a cached catalog by branch and staff credential, and keeps mixed sensitive batches online", async () => {
    let online = true;
    const sensitiveBatch = "/api/trpc/catalog.listProducts%2Creports.profit%3F?batch=1";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!online) throw new Error("offline");
      const branch = new Headers(init?.headers).get("x-branch-id");
      const catalog = result([{ name: `catalog-branch-${branch}`, cost: 87 }]);
      return Response.json(url.includes("batch=1") ? [catalog, result({ profit: 88 })] : catalog);
    }));
    const localUrl = await runtime().start();
    const headers = { authorization: authorization(), "x-branch-id": "1" };
    expect((await localRequest(`${localUrl}${catalogPath}`, "GET", "", headers)).body).toContain('"cost":87');
    expect((await localRequest(`${localUrl}${sensitiveBatch}`, "GET", "", headers)).body).toContain('"profit":88');

    online = false;
    const cached = await localRequest(`${localUrl}${catalogPath}`, "GET", "", headers);
    expect(cached.body).toContain("catalog-branch-1");
    expect(cached.body).toContain('"cost":0');
    for (const changed of [
      { ...headers, "x-branch-id": "2" },
      { ...headers, authorization: authorization("staff-b") },
      { "x-branch-id": "1" },
    ]) {
      expect((await localRequest(`${localUrl}${catalogPath}`, "GET", "", changed)).status).toBe(503);
    }
    expect((await localRequest(`${localUrl}${sensitiveBatch}`, "GET", "", headers)).status).toBe(503);
  });

  it("expires cached staff data and discards it after a live authorization denial", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let status = 200;
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (status === 503) throw new Error("offline");
        return Response.json(result([{ name: "catalog" }]), { status });
      }));
      const localUrl = await runtime().start();
      const expires = Math.floor(Date.now() / 1000) + 20;
      const headers = { authorization: authorization("staff-a", expires) };
      const send = () => localRequest(`${localUrl}${catalogPath}`, "GET", "", headers);
      expect((await send()).status).toBe(200);
      status = 403;
      expect((await send()).status).toBe(403);
      status = 503;
      expect((await send()).status).toBe(503);
      status = 200;
      expect((await send()).status).toBe(200);
      status = 503;
      vi.setSystemTime(expires * 1000);
      expect((await send()).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
        return Response.json({ products: ["existing-catalog"] });
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
    await localRequest(`${localUrl}${catalogPath}`);
    const stored = JSON.parse(
      fs.readFileSync(path.join(dataDir, "desktop-offline-state.json"), "utf8")
    );
    expect(Object.keys(stored.cache)).toEqual([cacheKey("GET", catalogPath)]);

    online = false;
    for (const requestPath of statusPaths) {
      const response = await localRequest(`${localUrl}${requestPath}`);
      expect(response.status).toBe(503);
      expect(response.headers["x-pos-offline-cache"]).toBeUndefined();
      expect(response.body).not.toContain("unclaimed");
    }
    const catalog = await localRequest(`${localUrl}${catalogPath}`);
    expect(catalog.status).toBe(200);
    expect(catalog.headers["x-pos-offline-cache"]).toBe("1");
    expect(catalog.body).toContain("existing-catalog");
    expect(instance.getStatus().pendingCount).toBe(0);
  });

  it("ignores stale installation status already persisted by an older runtime", async () => {
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
    expect((await localRequest(`${localUrl}${catalogPath}`)).body).toContain(
      "preserved-catalog"
    );
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

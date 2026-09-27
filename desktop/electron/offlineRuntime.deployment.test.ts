import fs from "node:fs";
import { get } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopSaleRequest } from "../../web/contracts/offline";
import { DesktopOfflineRuntime } from "./offlineRuntime";

const directories: string[] = [];
const runtimes: DesktopOfflineRuntime[] = [];

const sale: DesktopSaleRequest = {
  staffToken: "business-a-session",
  input: {
    staffName: "Test cashier",
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
    path.join(os.tmpdir(), "pos-deployment-test-")
  );
  directories.push(directory);
  return directory;
}

function runtime(remoteOrigin: string, dataDir = tempDirectory()) {
  const instance = new DesktopOfflineRuntime({
    dataDir,
    staticDir: dataDir,
    remoteOrigin,
  });
  runtimes.push(instance);
  return instance;
}

function localRequest(
  url: string
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    get(url, response => {
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
    }).on("error", reject);
  });
}

afterEach(() => {
  for (const instance of runtimes.splice(0)) instance.stop();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop deployment binding", () => {
  it("holds queued sales and prevents cache/network reuse after the configured business changes", async () => {
    const remoteFetch = vi.fn(async (url: string | URL | Request) => {
      const address = String(url);
      if (address.includes("catalog.listProducts")) {
        return Response.json({ products: ["business-a-only-data"] });
      }
      if (address.includes("/ping")) return Response.json({ ok: true });
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", remoteFetch);
    const dataDir = tempDirectory();
    const source = runtime("https://business-a.example.test", dataDir);
    const sourceUrl = await source.start();
    const cachedPath = "/api/trpc/catalog.listProducts";
    expect((await localRequest(`${sourceUrl}${cachedPath}`)).body).toContain(
      "business-a-only-data"
    );
    await source.createSale(sale);
    source.stop();

    const stateFile = path.join(dataDir, "desktop-offline-state.json");
    const originalState = fs.readFileSync(stateFile, "utf8");
    expect(originalState).toContain("business-a-session");
    remoteFetch.mockClear();

    const changed = runtime("https://business-b.example.test", dataDir);
    expect(changed.getStatus()).toMatchObject({
      pendingCount: 1,
      online: false,
    });
    expect(changed.getStatus().lastError).toContain(
      "https://business-a.example.test"
    );
    const status = await changed.retrySync("business-b-session");
    expect(status.pendingCount).toBe(1);
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(stateFile, "utf8")).toBe(originalState);

    const changedUrl = await changed.start();
    const response = await localRequest(`${changedUrl}${cachedPath}`);
    expect(response.status).toBe(409);
    expect(response.body).not.toContain("business-a-only-data");
    expect(response.headers["x-pos-offline-cache"]).toBeUndefined();
    expect(remoteFetch).not.toHaveBeenCalled();
    await expect(changed.createSale(sale)).rejects.toThrow("ระบบต้นทาง");
    expect(fs.readFileSync(stateFile, "utf8")).toBe(originalState);

    const recovery = JSON.parse(changed.createRecoverySnapshot());
    expect(recovery.remoteOrigin).toBe("https://business-a.example.test");
    expect(recovery.queue).toHaveLength(1);
    const restoredOrigin = runtime("https://business-a.example.test", dataDir);
    expect(restoredOrigin.getStatus().lastError).toBeNull();
    expect(restoredOrigin.getStatus().pendingCount).toBe(1);
  });

  it("imports recovery only into its bound business and preserves rejected target data", async () => {
    const source = runtime("https://business-a.example.test");
    await source.createSale(sale);
    const snapshot = source.createRecoverySnapshot();
    const otherBusiness = runtime("https://business-b.example.test");
    await otherBusiness.createSale({
      ...sale,
      staffToken: "business-b-session",
    });
    const before = otherBusiness.createRecoverySnapshot();
    expect(() => otherBusiness.importRecoverySnapshot(snapshot)).toThrow(
      "กิจการต้นทาง"
    );
    expect(JSON.parse(otherBusiness.createRecoverySnapshot()).queue).toEqual(
      JSON.parse(before).queue
    );

    const sameBusiness = runtime("https://BUSINESS-A.example.test:443/");
    expect(sameBusiness.importRecoverySnapshot(snapshot)).toEqual({
      importedCount: 1,
      pendingCount: 1,
    });
    expect(sameBusiness.importRecoverySnapshot(snapshot)).toEqual({
      importedCount: 0,
      pendingCount: 1,
    });
  });

  it("holds legacy pending sales with unknown provenance without replacing credentials or removing receipts", async () => {
    const dataDir = tempDirectory();
    const source = runtime("https://business-a.example.test", dataDir);
    await source.createSale(sale);
    const stateFile = path.join(dataDir, "desktop-offline-state.json");
    const legacy = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    delete legacy.remoteOrigin;
    fs.writeFileSync(stateFile, JSON.stringify(legacy), "utf8");
    const original = fs.readFileSync(stateFile, "utf8");
    const remoteFetch = vi.fn();
    vi.stubGlobal("fetch", remoteFetch);

    const reopened = runtime("https://business-a.example.test", dataDir);
    expect(reopened.getStatus().lastError).toContain("พักการซิงก์");
    expect((await reopened.retrySync("replacement-session")).pendingCount).toBe(
      1
    );
    const localUrl = await reopened.start();
    expect(
      (await localRequest(`${localUrl}/api/trpc/catalog.listProducts`)).status
    ).toBe(409);
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(stateFile, "utf8")).toBe(original);
    const recovery = JSON.parse(reopened.createRecoverySnapshot());
    expect(recovery.remoteOrigin).toBeNull();
    expect(recovery.queue[0].staffToken).toBe("business-a-session");

    const target = runtime("https://business-a.example.test");
    expect(() =>
      target.importRecoverySnapshot(JSON.stringify(recovery))
    ).toThrow("ตรวจสอบกิจการต้นทาง");
    expect(target.getStatus().pendingCount).toBe(0);
  });

  it("binds an empty legacy queue while clearing cached data with unknown provenance", () => {
    const dataDir = tempDirectory();
    const stateFile = path.join(dataDir, "desktop-offline-state.json");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        deviceId: "legacy-device",
        receiptCounter: 9,
        cache: {
          oldData: {
            bodyBase64: Buffer.from("previous-business-data").toString(
              "base64"
            ),
          },
        },
        queue: [],
        lastSyncedAt: "2026-09-26T00:00:00Z",
      }),
      "utf8"
    );

    const reopened = runtime("https://business-a.example.test", dataDir);
    expect(reopened.getStatus()).toMatchObject({
      pendingCount: 0,
      lastError: null,
    });
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toMatchObject({
      remoteOrigin: "https://business-a.example.test",
      deviceId: "legacy-device",
      receiptCounter: 9,
      cache: {},
      queue: [],
      lastSyncedAt: null,
    });
  });
});

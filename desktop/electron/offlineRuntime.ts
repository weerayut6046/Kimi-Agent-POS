import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../web/api/router";
import type {
  DesktopReceipt,
  DesktopSaleRequest,
  DesktopSaleResult,
  DesktopSyncStatus,
} from "../../web/contracts/offline";

type RemoteSaleInput = DesktopSaleRequest["input"] & {
  clientReceiptNo: string;
  clientCreatedAt: string;
};

type CachedResponse = {
  status: number;
  contentType: string;
  bodyBase64: string;
  storedAt: string;
};

type QueuedSale = {
  receiptNo: string;
  createdAt: string;
  remoteInput: RemoteSaleInput;
  staffToken?: string;
  localReceipt: DesktopReceipt;
  attempts: number;
  lastError: string | null;
};

type PersistedState = {
  version: 1;
  deviceId: string;
  receiptCounter: number;
  cache: Record<string, CachedResponse>;
  queue: QueuedSale[];
  lastSyncedAt: string | null;
};

type RuntimeOptions = {
  dataDir: string;
  staticDir: string;
  remoteOrigin: string;
  onStatus?: (status: DesktopSyncStatus) => void;
};

const CACHE_LIMIT = 250;
const REQUEST_TIMEOUT_MS = 8_000;
const SYNC_INTERVAL_MS = 10_000;

const r2 = (value: number) => Math.round(value * 100) / 100;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newState(): PersistedState {
  return {
    version: 1,
    deviceId: randomUUID(),
    receiptCounter: 0,
    cache: {},
    queue: [],
    lastSyncedAt: null,
  };
}

export function buildOfflineReceipt(
  request: DesktopSaleRequest,
  receiptNo: string,
  createdAt: Date,
  localId: number
): DesktopReceipt {
  const lines = request.input.items.map(item => {
    const snapshot = request.lines.find(
      line => line.productId === item.productId
    );
    if (!snapshot) {
      throw new Error(
        `ไม่พบข้อมูลสินค้า #${item.productId} สำหรับบันทึกออฟไลน์`
      );
    }
    return {
      name: snapshot.name,
      qty: item.qty,
      unit: snapshot.unit,
      unitPrice: snapshot.unitPrice,
      amount: r2(snapshot.unitPrice * item.qty),
    };
  });
  const subtotal = r2(lines.reduce((sum, line) => sum + line.amount, 0));
  const redeemDiscount = r2(
    request.input.pointsToRedeem * request.context.pointRedeemValue
  );
  const totalDiscount = r2(request.input.discount + redeemDiscount);
  const total = r2(Math.max(0, subtotal - totalDiscount));
  const vatAmount = r2(
    (total * request.context.vatRate) / (100 + request.context.vatRate)
  );
  const changeAmt =
    request.input.paymentMethod === "cash"
      ? r2(Math.max(0, request.input.received - total))
      : 0;
  const pointsEarned = request.input.memberId
    ? Math.floor(total / request.context.pointEarnPerBaht)
    : 0;

  return {
    sale: {
      id: localId,
      receiptNo,
      createdAt,
      subtotal,
      discount: totalDiscount,
      vatRate: request.context.vatRate,
      vatAmount,
      total,
      paymentMethod: request.input.paymentMethod,
      received:
        request.input.paymentMethod === "cash" ? request.input.received : total,
      changeAmt,
      pointsEarned,
      pointsRedeemed: request.input.pointsToRedeem,
      memberName: request.context.memberName,
      customerName: request.context.customerName,
    },
    items: lines,
  };
}

export class DesktopOfflineRuntime {
  private readonly options: RuntimeOptions;
  private readonly stateFile: string;
  private state: PersistedState;
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private online = false;
  private lastError: string | null = null;

  constructor(options: RuntimeOptions) {
    this.options = {
      ...options,
      remoteOrigin: options.remoteOrigin.replace(/\/$/, ""),
    };
    fs.mkdirSync(options.dataDir, { recursive: true });
    this.stateFile = path.join(options.dataDir, "desktop-offline-state.json");
    this.state = this.loadState();
  }

  getStatus(): DesktopSyncStatus {
    return {
      desktop: true,
      online: this.online,
      syncing: this.syncing,
      pendingCount: this.state.queue.length,
      lastSyncedAt: this.state.lastSyncedAt,
      lastError: this.lastError,
    };
  }

  async start(): Promise<string> {
    if (this.server) throw new Error("Desktop offline server already started");
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("ไม่สามารถเปิด local desktop server ได้");
    }
    this.timer = setInterval(() => void this.checkAndSync(), SYNC_INTERVAL_MS);
    void this.checkAndSync();
    return `http://127.0.0.1:${address.port}`;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.server?.close();
    this.server = null;
  }

  async createSale(request: DesktopSaleRequest): Promise<DesktopSaleResult> {
    const { receiptNo, counter } = this.reserveReceiptNo();
    const createdAt = new Date();
    const remoteInput: RemoteSaleInput = {
      ...request.input,
      clientReceiptNo: receiptNo,
      clientCreatedAt: createdAt.toISOString(),
    };

    if (!this.online) {
      return this.queueSale(
        request,
        remoteInput,
        receiptNo,
        createdAt,
        counter
      );
    }

    let reachedServer = false;
    try {
      const receipt = await this.sendSale(
        remoteInput,
        request.staffToken,
        () => {
          reachedServer = true;
        }
      );
      this.setOnline(true);
      void this.syncPending();
      return {
        ...receipt,
        mode: "online",
        pendingCount: this.state.queue.length,
      };
    } catch (error) {
      if (reachedServer) {
        this.setOnline(true, messageOf(error));
        throw error;
      }

      this.setOnline(false, "อินเทอร์เน็ตขัดข้อง — กำลังเก็บบิลไว้ในเครื่อง");
      return this.queueSale(
        request,
        remoteInput,
        receiptNo,
        createdAt,
        counter
      );
    }
  }

  async retrySync(): Promise<DesktopSyncStatus> {
    await this.syncPending();
    return this.getStatus();
  }

  private queueSale(
    request: DesktopSaleRequest,
    remoteInput: RemoteSaleInput,
    receiptNo: string,
    createdAt: Date,
    counter: number
  ): DesktopSaleResult {
    if (request.input.paymentMethod === "credit") {
      throw new Error(
        "ขณะออฟไลน์ยังไม่รองรับการขายเชื่อ กรุณาเลือกเงินสด QR หรือบัตร"
      );
    }
    if (request.input.pointsToRedeem > 0) {
      throw new Error(
        "ขณะออฟไลน์ยังไม่รองรับการใช้แต้ม กรุณาตั้งค่าแต้มที่ใช้เป็น 0"
      );
    }

    const localReceipt = buildOfflineReceipt(
      request,
      receiptNo,
      createdAt,
      -counter
    );
    this.state.queue.push({
      receiptNo,
      createdAt: createdAt.toISOString(),
      remoteInput,
      staffToken: request.staffToken,
      localReceipt,
      attempts: 0,
      lastError: null,
    });
    this.saveState();
    this.emitStatus();
    return {
      ...localReceipt,
      mode: "queued",
      pendingCount: this.state.queue.length,
    };
  }

  private loadState(): PersistedState {
    if (!fs.existsSync(this.stateFile)) return newState();
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.stateFile, "utf8")
      ) as Partial<PersistedState>;
      if (
        parsed.version !== 1 ||
        typeof parsed.deviceId !== "string" ||
        !Array.isArray(parsed.queue)
      ) {
        throw new Error("unsupported state format");
      }
      return {
        version: 1,
        deviceId: parsed.deviceId,
        receiptCounter: Number(parsed.receiptCounter) || 0,
        cache: parsed.cache ?? {},
        queue: parsed.queue,
        lastSyncedAt: parsed.lastSyncedAt ?? null,
      };
    } catch {
      const preserved = `${this.stateFile}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.stateFile, preserved);
      return newState();
    }
  }

  private saveState(): void {
    const tempFile = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.state), "utf8");
    try {
      fs.renameSync(tempFile, this.stateFile);
    } catch {
      fs.rmSync(this.stateFile, { force: true });
      fs.renameSync(tempFile, this.stateFile);
    }
  }

  private reserveReceiptNo(): { receiptNo: string; counter: number } {
    this.state.receiptCounter += 1;
    const counter = this.state.receiptCounter;
    const device = this.state.deviceId
      .replace(/-/g, "")
      .slice(0, 6)
      .toUpperCase();
    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const receiptNo = `OFF-${device}-${stamp}-${String(counter).padStart(4, "0")}`;
    this.saveState();
    return { receiptNo, counter };
  }

  private async sendSale(
    remoteInput: RemoteSaleInput,
    staffToken: string | undefined,
    onResponse: () => void
  ): Promise<DesktopReceipt> {
    const client = createTRPCProxyClient<AppRouter>({
      links: [
        httpLink({
          url: `${this.options.remoteOrigin}/api/trpc`,
          transformer: superjson,
          headers: staffToken ? { "x-staff-session": staffToken } : undefined,
          fetch: async (input, init) => {
            const controller = new AbortController();
            const timeout = setTimeout(
              () => controller.abort(),
              REQUEST_TIMEOUT_MS
            );
            try {
              const response = await fetch(input, {
                ...init,
                signal: controller.signal,
              });
              onResponse();
              return response;
            } finally {
              clearTimeout(timeout);
            }
          },
        }),
      ],
    });
    const result = await client.pos.createSale.mutate({
      ...remoteInput,
      clientCreatedAt: new Date(remoteInput.clientCreatedAt),
    });
    return result as DesktopReceipt;
  }

  private async checkAndSync(): Promise<void> {
    if (this.state.queue.length > 0) {
      await this.syncPending();
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${this.options.remoteOrigin}/api/trpc/ping?input=%7B%22json%22%3Anull%7D`,
        { signal: controller.signal }
      );
      this.setOnline(
        response.ok,
        response.ok ? null : `HTTP ${response.status}`
      );
    } catch (error) {
      this.setOnline(false, messageOf(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async syncPending(): Promise<void> {
    if (this.syncing || this.state.queue.length === 0) return;
    this.syncing = true;
    this.emitStatus();
    try {
      while (this.state.queue.length > 0) {
        const queued = this.state.queue[0]!;
        let reachedServer = false;
        try {
          await this.sendSale(queued.remoteInput, queued.staffToken, () => {
            reachedServer = true;
          });
          this.state.queue.shift();
          this.state.lastSyncedAt = new Date().toISOString();
          this.lastError = null;
          this.online = true;
          this.saveState();
          this.emitStatus();
        } catch (error) {
          queued.attempts += 1;
          queued.lastError = messageOf(error);
          this.lastError = queued.lastError;
          this.online = reachedServer;
          this.saveState();
          break;
        }
      }
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  private setOnline(online: boolean, error: string | null = null): void {
    this.online = online;
    this.lastError = error;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.options.onStatus?.(this.getStatus());
  }

  private async handleRequest(
    req: IncomingMessage,
    res: import("node:http").ServerResponse
  ): Promise<void> {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname.startsWith("/api/")) {
        await this.proxyApi(req, res, requestUrl);
        return;
      }
      this.serveStatic(req, res, requestUrl.pathname);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(messageOf(error));
    }
  }

  private async proxyApi(
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
    requestUrl: URL
  ): Promise<void> {
    const method = req.method ?? "GET";
    const body = await this.readBody(req);
    const key = this.cacheKey(
      method,
      requestUrl,
      body,
      req.headers["x-staff-session"]
    );
    const remoteUrl = `${this.options.remoteOrigin}${requestUrl.pathname}${requestUrl.search}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (
        value == null ||
        ["host", "connection", "content-length", "accept-encoding"].includes(
          name.toLowerCase()
        )
      ) {
        continue;
      }
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(remoteUrl, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        signal: controller.signal,
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      this.setOnline(true);
      if (response.ok && this.isCacheable(method, requestUrl.pathname)) {
        this.state.cache[key] = {
          status: response.status,
          contentType:
            response.headers.get("content-type") ??
            "application/json; charset=utf-8",
          bodyBase64: responseBody.toString("base64"),
          storedAt: new Date().toISOString(),
        };
        this.pruneCache();
        this.saveState();
      }
      res.writeHead(response.status, {
        "content-type":
          response.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(responseBody);
      if (this.state.queue.length > 0) void this.syncPending();
    } catch (error) {
      this.setOnline(false, messageOf(error));
      const cached = this.state.cache[key];
      if (cached) {
        res.writeHead(cached.status, {
          "content-type": cached.contentType,
          "cache-control": "no-store",
          "x-pos-offline-cache": "1",
        });
        res.end(Buffer.from(cached.bodyBase64, "base64"));
        return;
      }
      res.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: {
            message: "ไม่มีอินเทอร์เน็ตและยังไม่มีข้อมูลนี้ในแคชของเครื่อง",
          },
        })
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 10 * 1024 * 1024) {
          reject(new Error("request body ใหญ่เกินขนาดที่กำหนด"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  private cacheKey(
    method: string,
    requestUrl: URL,
    body: Buffer,
    staffSession: string | string[] | undefined
  ): string {
    return createHash("sha256")
      .update(method)
      .update("\0")
      .update(requestUrl.pathname)
      .update(requestUrl.search)
      .update("\0")
      .update(body)
      .update("\0")
      .update(
        Array.isArray(staffSession)
          ? staffSession.join(",")
          : (staffSession ?? "")
      )
      .digest("hex");
  }

  private isCacheable(method: string, pathname: string): boolean {
    return method === "GET" || pathname.endsWith("/auth.login");
  }

  private pruneCache(): void {
    const entries = Object.entries(this.state.cache);
    if (entries.length <= CACHE_LIMIT) return;
    entries
      .sort(
        ([, left], [, right]) =>
          new Date(left.storedAt).getTime() - new Date(right.storedAt).getTime()
      )
      .slice(0, entries.length - CACHE_LIMIT)
      .forEach(([key]) => delete this.state.cache[key]);
  }

  private serveStatic(
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
    pathname: string
  ): void {
    const decoded = decodeURIComponent(pathname);
    const relative =
      decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    let filePath = path.resolve(this.options.staticDir, relative);
    const staticRoot = path.resolve(this.options.staticDir);
    if (
      !filePath.startsWith(`${staticRoot}${path.sep}`) &&
      filePath !== staticRoot
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(staticRoot, "index.html");
    }
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extension] ?? "application/octet-stream",
      "content-length": stat.size,
      "cache-control":
        extension === ".html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }
}

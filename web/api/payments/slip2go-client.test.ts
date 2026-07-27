import { describe, it, expect } from "vitest";
import {
  createSlip2GoClient,
  isDuplicateSlipError,
  Slip2GoError,
  type Slip2GoConfig,
} from "./slip2go-client";

type FetchLike = Parameters<typeof createSlip2GoClient>[1];

const config: Slip2GoConfig = {
  baseUrl: "https://connect.slip2go.com/",
  apiSecret: "test-secret",
  timeoutMs: 1_000,
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("slip2go-client — HTTP contract", () => {
  it("getAccountInfo: GET /api/account/info พร้อม Bearer secret และ parse code 200001", async () => {
    let seenUrl = "";
    let seenInit: { method?: string; headers?: Record<string, string> } = {};
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenInit = init ?? {};
      return jsonResponse(200, {
        code: "200001",
        data: {
          shopName: "ปั๊มทดสอบ",
          package: "trial",
          packageExpiredDate: "2026-08-02",
          tokenLimit: 50,
          tokenRemaining: 48.5,
          tokenPerSlip: 0.5,
          estimatedQuotaSlip: 97,
        },
      });
    };
    const client = createSlip2GoClient(config, fetchImpl);
    const info = await client.getAccountInfo();
    expect(seenUrl).toBe("https://connect.slip2go.com/api/account/info");
    expect(seenInit.method).toBe("GET");
    expect(seenInit.headers?.authorization).toBe("Bearer test-secret");
    expect(info.shopName).toBe("ปั๊มทดสอบ");
    expect(info.packageName).toBe("trial");
    expect(info.tokenRemaining).toBe(48.5);
    expect(info.estimatedQuotaSlip).toBe(97);
  });

  it("verifySlipByQrCode: ส่ง checkDuplicate:true + checkReceiver และ parse code 200000", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      seenBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      return jsonResponse(200, {
        code: "200000",
        data: {
          referenceId: "REF-123",
          transRef: "TX-999",
          dateTime: "2026-01-31T10:00:00.000Z",
          amount: 20,
          receiver: {
            account: { proxy: { type: "MSISDN", account: "0812345678" } },
          },
          sender: { account: { name: { th: "นายทดสอบ", en: "TEST" } } },
        },
      });
    };
    const client = createSlip2GoClient(config, fetchImpl);
    const slip = await client.verifySlipByQrCode({
      qrCode: "SLIP-QR-PAYLOAD",
      checkReceiver: [{ accountType: "02001", accountNumber: "0812345678" }],
    });
    const payload = seenBody.payload as {
      qrCode: string;
      checkCondition: Record<string, unknown>;
    };
    expect(payload.qrCode).toBe("SLIP-QR-PAYLOAD");
    expect(payload.checkCondition.checkDuplicate).toBe(true);
    expect(payload.checkCondition.checkReceiver).toEqual([
      { accountType: "02001", accountNumber: "0812345678" },
    ]);
    // ไม่ส่ง checkAmount/checkDate — ตรวจเองฝั่งเซิร์ฟเวอร์
    expect("checkAmount" in payload.checkCondition).toBe(false);
    expect("checkDate" in payload.checkCondition).toBe(false);
    expect(slip.transRef).toBe("TX-999");
    expect(slip.amount).toBe(20);
    expect(slip.senderName).toBe("นายทดสอบ");
  });

  it("checkReceiver ว่าง (โหมด merchant) → ไม่ส่ง key checkReceiver ใน checkCondition", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      seenBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      return jsonResponse(200, {
        code: "200000",
        data: { referenceId: "R", transRef: "T", dateTime: "2026-01-31T10:00:00.000Z", amount: 1 },
      });
    };
    const client = createSlip2GoClient(config, fetchImpl);
    await client.verifySlipByQrCode({ qrCode: "X", checkReceiver: [] });
    const payload = seenBody.payload as { checkCondition: Record<string, unknown> };
    expect(payload.checkCondition.checkDuplicate).toBe(true);
    expect("checkReceiver" in payload.checkCondition).toBe(false);
  });

  it("code ไม่ใช่ code สำเร็จ → Slip2GoError พร้อม code เดิม", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse(200, { code: "400201", message: "this slip is duplicated" });
    const client = createSlip2GoClient(config, fetchImpl);
    const error = await client
      .verifySlipByQrCode({ qrCode: "X", checkReceiver: [] })
      .catch(e => e);
    expect(error).toBeInstanceOf(Slip2GoError);
    expect((error as Slip2GoError).code).toBe("400201");
    expect((error as Slip2GoError).message).toContain("duplicated");
    expect(isDuplicateSlipError(error as Slip2GoError)).toBe(true);
  });

  it("HTTP ไม่ใช่ 2xx → Slip2GoError", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse(401, { code: "401001", message: "unauthorized" });
    const client = createSlip2GoClient(config, fetchImpl);
    const error = await client.getAccountInfo().catch(e => e);
    expect(error).toBeInstanceOf(Slip2GoError);
    expect((error as Slip2GoError).httpStatus).toBe(401);
  });

  it("timeout → Slip2GoError code SLIP2GO_TIMEOUT", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const client = createSlip2GoClient({ ...config, timeoutMs: 20 }, fetchImpl);
    const error = await client.getAccountInfo().catch(e => e);
    expect(error).toBeInstanceOf(Slip2GoError);
    expect((error as Slip2GoError).code).toBe("SLIP2GO_TIMEOUT");
  });
});

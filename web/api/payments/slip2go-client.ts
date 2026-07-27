/**
 * Slip2Go client (connect.slip2go.com) — ตรวจสลิปโอนเงินจาก QR บนสลิปของลูกค้า
 *
 * รายละเอียดการเชื่อมต่อภายนอกทั้งหมดรวมอยู่ในไฟล์นี้ไฟล์เดียว
 * (base URL, header auth, path ของแต่ละ endpoint, รูปแบบ request/response)
 *
 * Contract ที่ยืนยันกับเอกสาร Slip2Go แล้ว:
 * - Auth: `Authorization: Bearer <SLIP2GO_API_SECRET>` (secret จาก Slip2Go Dashboard > API Connect)
 * - GET  {base}/api/account/info
 *     → { code: "200001", data: { shopName, package, packageExpiredDate,
 *         tokenLimit, tokenRemaining, quotaQrRemaining, tokenPerSlip,
 *         estimatedQuotaSlip, ... } }
 * - POST {base}/api/verify-slip/qr-code/info
 *     body: { payload: { qrCode, checkCondition: {
 *       checkDuplicate: true,
 *       checkReceiver: [{ accountType, accountNumber }] } } }
 *     accountType "02001" = พร้อมเพย์เบอร์โทร (10 หลัก), "02003" = เลขบัตรประชาชน/นิติบุคคล (13 หลัก)
 *     → success { code: "200000", data: { referenceId, transRef,
 *         dateTime (ISO UTC), amount (บาท), receiver: { account: { proxy: { type, account } } },
 *         sender: { account: { name: { th?, en? } } }, ... } }
 *
 * ไม่ส่ง checkAmount/checkDate ให้ Slip2Go — ตรวจยอดเงิน (แม่นยำระดับสตางค์)
 * และช่วงเวลารายการฝั่งเซิร์ฟเวอร์เราเอง หลังได้ผลสลิปกลับมา
 * ทุกอย่างที่ไม่ใช่ code สำเร็จ (หรือ HTTP ไม่ใช่ 2xx) ถือว่าสลิปไม่ผ่าน
 *
 * โหมด mock: ตั้ง SLIP2GO_MOCK=1 เพื่อให้ client ตอบจำลองโดยไม่เรียก network
 * (ใช้ใน dev/test) — ดู createMockSlip2GoClient สำหรับการควบคุมผลลัพธ์ใน unit test
 */

export type Slip2GoConfig = {
  baseUrl: string;
  apiSecret: string;
  timeoutMs: number;
};

export type Slip2GoAccountInfo = {
  shopName: string | null;
  packageName: string | null;
  packageExpiredDate: string | null;
  tokenRemaining: number | null;
  estimatedQuotaSlip: number | null;
  raw: unknown;
};

/** เงื่อนไขบัญชีปลายทางที่ร้านเป็นเจ้าของ — สลิปที่โอนเข้าบัญชีอื่นจะไม่ผ่าน */
export type Slip2GoReceiverCondition = {
  accountType: "02001" | "02003";
  accountNumber: string;
};

export type Slip2GoVerifyInput = {
  qrCode: string;
  checkReceiver: Slip2GoReceiverCondition[];
};

export type Slip2GoVerifiedSlip = {
  referenceId: string | null;
  transRef: string;
  /** ISO timestamp (UTC) ของรายการโอนจริงตามธนาคาร */
  dateTime: string;
  /** ยอดเงินหน่วยบาท */
  amount: number;
  senderName: string | null;
  /** บัญชีปลายทางจากสลิป (ใช้ตรวจเองในโหมด merchant QR — ดู sessionService) */
  receiverProxyType: string | null;
  receiverProxyAccount: string | null;
  receiverBankAccount: string | null;
  raw: unknown;
};

export class Slip2GoError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    code = "SLIP2GO_ERROR",
    httpStatus: number | null = null
  ) {
    super(message);
    this.name = "Slip2GoError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** สลิปซ้ำ (ถูกตรวจไปแล้วกับ Slip2Go) — ใช้แยกข้อความเตือนแคชเชียร์ */
export function isDuplicateSlipError(error: Slip2GoError): boolean {
  return /duplicat/i.test(error.code) || /duplicat/i.test(error.message);
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type Slip2GoEnvelope<T> = {
  code?: string;
  message?: string;
  data?: T;
};

export type Slip2GoClient = {
  /** ตรวจการเชื่อมต่อ/สิทธิ์ของ secret + โควตาคงเหลือ (GET /api/account/info) */
  getAccountInfo: () => Promise<Slip2GoAccountInfo>;
  /**
   * ตรวจสลิปจาก QR payload ที่แคชเชียร์สแกนจากสลิปของลูกค้า
   * ส่ง checkDuplicate: true เสมอ — Slip2Go จะปฏิเสธสลิปที่เคยตรวจแล้ว
   */
  verifySlipByQrCode: (
    input: Slip2GoVerifyInput
  ) => Promise<Slip2GoVerifiedSlip>;
};

export function createSlip2GoClient(
  config: Slip2GoConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Slip2GoClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    expectedCode: string,
    body?: Record<string, unknown>
  ): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let httpStatus: number | null = null;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.apiSecret}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      httpStatus = response.status;
      const parsed = (await response.json()) as Slip2GoEnvelope<T>;
      if (!response.ok || parsed.code !== expectedCode) {
        throw new Slip2GoError(
          parsed.message || `Slip2Go ตอบ HTTP ${response.status}`,
          parsed.code || `HTTP_${response.status}`,
          response.status
        );
      }
      return parsed.data as T;
    } catch (error) {
      if (error instanceof Slip2GoError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new Slip2GoError(
        aborted
          ? "Slip2Go ไม่ตอบภายในเวลาที่กำหนด"
          : "เชื่อมต่อ Slip2Go ไม่สำเร็จ",
        aborted ? "SLIP2GO_TIMEOUT" : "SLIP2GO_NETWORK",
        httpStatus
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    getAccountInfo: async () => {
      const data = await request<{
        shopName?: string;
        package?: string;
        packageExpiredDate?: string;
        tokenRemaining?: number;
        estimatedQuotaSlip?: number;
      }>("GET", "/api/account/info", "200001");
      return {
        shopName: data?.shopName ?? null,
        packageName: data?.package ?? null,
        packageExpiredDate: data?.packageExpiredDate ?? null,
        tokenRemaining:
          typeof data?.tokenRemaining === "number" ? data.tokenRemaining : null,
        estimatedQuotaSlip:
          typeof data?.estimatedQuotaSlip === "number"
            ? data.estimatedQuotaSlip
            : null,
        raw: data ?? null,
      };
    },

    verifySlipByQrCode: async input => {
      const data = await request<{
        referenceId?: string;
        transRef?: string;
        dateTime?: string;
        amount?: number;
        receiver?: {
          account?: {
            proxy?: { type?: string; account?: string };
            bank?: { account?: string };
          };
        };
        sender?: {
          account?: { name?: { th?: string; en?: string } | string };
        };
      }>("POST", "/api/verify-slip/qr-code/info", "200000", {
        payload: {
          qrCode: input.qrCode,
          checkCondition: {
            checkDuplicate: true,
            // ส่ง checkReceiver เฉพาะเมื่อระบุ — โหมด merchant QR (ถุงเงิน biller)
            // Slip2Go ไม่มี accountType ที่ครอบคลุม จึงตรวจผู้รับเองฝั่งเซิร์ฟเวอร์
            ...(input.checkReceiver.length > 0
              ? { checkReceiver: input.checkReceiver }
              : {}),
          },
        },
      });
      const senderName =
        typeof data?.sender?.account?.name === "string"
          ? data.sender.account.name
          : (data?.sender?.account?.name?.th ??
            data?.sender?.account?.name?.en ??
            null);
      return {
        referenceId: data?.referenceId ?? null,
        transRef: data?.transRef ?? "",
        dateTime: data?.dateTime ?? "",
        amount: Number(data?.amount ?? 0),
        senderName,
        receiverProxyType: data?.receiver?.account?.proxy?.type ?? null,
        receiverProxyAccount: data?.receiver?.account?.proxy?.account ?? null,
        receiverBankAccount: data?.receiver?.account?.bank?.account ?? null,
        raw: data ?? null,
      };
    },
  };
}

export type MockSlip2GoBehavior = {
  accountInfo?: Slip2GoAccountInfo | Error;
  verifySlip?:
    | Slip2GoVerifiedSlip
    | Error
    | ((input: Slip2GoVerifyInput) => Slip2GoVerifiedSlip | Error);
};

/**
 * client จำลองสำหรับ unit test / dev — ผลลัพธ์ควบคุมได้ทั้งหมด
 * และบันทึกจำนวนครั้งที่ถูกเรียกพร้อม input ล่าสุด
 */
export function createMockSlip2GoClient(behavior: MockSlip2GoBehavior = {}) {
  const calls = {
    getAccountInfo: 0,
    verifySlipByQrCode: 0,
  };
  let lastVerifyInput: Slip2GoVerifyInput | null = null;
  const client: Slip2GoClient = {
    getAccountInfo: async () => {
      calls.getAccountInfo += 1;
      const value = behavior.accountInfo ?? {
        shopName: "ร้านทดสอบ (mock)",
        packageName: "trial",
        packageExpiredDate: null,
        tokenRemaining: 50,
        estimatedQuotaSlip: 100,
        raw: null,
      };
      if (value instanceof Error) throw value;
      return value;
    },
    verifySlipByQrCode: async input => {
      calls.verifySlipByQrCode += 1;
      lastVerifyInput = input;
      const configured = behavior.verifySlip;
      const value =
        typeof configured === "function"
          ? configured(input)
          : (configured ?? {
              referenceId: "REF-MOCK-1",
              transRef: "MOCK-TRANSREF-1",
              dateTime: new Date().toISOString(),
              amount: 0,
              senderName: "ลูกค้าจำลอง",
              receiverProxyType: null,
              receiverProxyAccount: null,
              receiverBankAccount: null,
              raw: null,
            });
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { client, calls, getLastVerifyInput: () => lastVerifyInput };
}

/**
 * mock ที่แชร์ผ่าน module สำหรับโหมด SLIP2GO_MOCK=1 (dev)
 * paymentConfig สร้าง client จาก behavior ล่าสุดทุกครั้งที่ขอ runtime config
 */
let sharedMockBehavior: MockSlip2GoBehavior = {};

export function setSharedMockSlip2GoBehavior(behavior: MockSlip2GoBehavior) {
  sharedMockBehavior = behavior;
}

export function createSharedMockSlip2GoClient(): Slip2GoClient {
  return createMockSlip2GoClient(sharedMockBehavior).client;
}

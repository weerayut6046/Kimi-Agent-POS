import { eq } from "drizzle-orm";
import { paymentSettings } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto";
import { extractMerchantBillInfo } from "../lib/promptpay";
import type {
  MerchantBillInfoView,
  PaymentConfigSummary,
  ThungngernQrMode,
} from "@contracts/payments";
import {
  createSlip2GoClient,
  createSharedMockSlip2GoClient,
  type Slip2GoClient,
} from "./slip2go-client";

const KEY_SCOPE = "pump-pos:payments-secret:v1";
const SECRET_CONTEXT = "pump-pos:payments:easy-api-key:v1";
const WEBHOOK_SECRET_CONTEXT = "pump-pos:payments:webhook-token:v1";

/** token สำหรับ webhook รับแจ้งเงินเข้า — สุ่มใหม่ทุกครั้งที่ admin กดสร้าง/เปลี่ยน */
export function generateWebhookToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `tngwh_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export type SavePaymentConfigInput = {
  branchId: number;
  thungngernEnabled: boolean;
  promptpayId: string;
  qrMode?: ThungngernQrMode;
  /** static merchant payload ต้นฉบับจากแอปถุงเงิน — เว้นว่าง/ไม่ส่ง = ใช้ของเดิม */
  merchantPayload?: string;
  apiSecret?: string;
  clearApiSecret?: boolean;
  /** true = สุ่ม webhook token ใหม่ (token เดิมใช้ไม่ได้อีก) */
  regenerateWebhookToken?: boolean;
};

async function readStoredConfig(branchId: number) {
  return getDb().query.paymentSettings.findFirst({
    where: eq(paymentSettings.branchId, branchId),
  });
}

function parseMerchantView(payload: string | null | undefined) {
  if (!payload) return null;
  try {
    const info = extractMerchantBillInfo(payload);
    return {
      billerId: info.billerId,
      ref1: info.ref1,
      ref2: info.ref2,
    } satisfies MerchantBillInfoView;
  } catch {
    return null;
  }
}

/** ถอดรหัส webhook token ของสาขา — คืน null ถ้ายังไม่เคยสร้าง */
export async function getStoredWebhookToken(
  branchId: number
): Promise<string | null> {
  const stored = await readStoredConfig(branchId);
  if (!stored?.webhookTokenEncrypted) return null;
  return decryptSecret(stored.webhookTokenEncrypted, {
    appSecret: env.appSecret,
    keyScope: KEY_SCOPE,
    context: WEBHOOK_SECRET_CONTEXT,
  });
}

/**
 * สรุปการตั้งค่าสำหรับ client — ไม่ส่ง secret ออกนอกเซิร์ฟเวอร์เด็ดขาด
 * includeWebhookToken ใช้เฉพาะ endpoint ระดับ admin ที่ต้องแสดง token ให้คัดลอก
 */
export async function getPaymentConfigSummary(
  branchId: number,
  opts: { includeWebhookToken?: boolean } = {}
): Promise<PaymentConfigSummary> {
  const stored = await readStoredConfig(branchId);
  const apiSecretSource = stored?.easyApiKeyEncrypted
    ? "settings"
    : env.slip2goApiSecret
      ? "environment"
      : "none";
  const qrMode: ThungngernQrMode =
    stored?.qrMode === "merchant" ? "merchant" : "promptpay";
  const webhookToken = opts.includeWebhookToken
    ? await getStoredWebhookToken(branchId)
    : null;
  return {
    thungngernEnabled: stored?.thungngernEnabled ?? false,
    promptpayId: stored?.promptpayId ?? "",
    qrMode,
    merchantPayload: stored?.merchantPayload ?? "",
    merchant: qrMode === "merchant" ? parseMerchantView(stored?.merchantPayload) : null,
    provider: stored?.provider ?? "slip2go",
    apiSecretConfigured: apiSecretSource !== "none" || env.slip2goMock,
    apiKeySource: apiSecretSource,
    settingsSource: stored ? "settings" : "environment",
    mockMode: env.slip2goMock,
    branchId,
    webhookConfigured: stored?.webhookTokenEncrypted != null,
    webhookToken,
  };
}

export async function savePaymentConfig(
  input: SavePaymentConfigInput
): Promise<PaymentConfigSummary> {
  const db = getDb();
  const existing = await readStoredConfig(input.branchId);
  const qrMode: ThungngernQrMode = input.qrMode ?? "promptpay";
  const merchantPayload = input.merchantPayload?.trim()
    ? input.merchantPayload.trim()
    : (existing?.merchantPayload ?? null);
  // validate ก่อนบันทึก — ต้องเป็น EMVCo ที่มี tag 30 bill payment AID
  if (merchantPayload) extractMerchantBillInfo(merchantPayload);
  const apiSecretEncrypted = input.clearApiSecret
    ? null
    : input.apiSecret
      ? await encryptSecret(input.apiSecret, {
          appSecret: env.appSecret,
          keyScope: KEY_SCOPE,
          context: SECRET_CONTEXT,
        })
      : (existing?.easyApiKeyEncrypted ?? null);
  const webhookTokenEncrypted = input.regenerateWebhookToken
    ? await encryptSecret(generateWebhookToken(), {
        appSecret: env.appSecret,
        keyScope: KEY_SCOPE,
        context: WEBHOOK_SECRET_CONTEXT,
      })
    : (existing?.webhookTokenEncrypted ?? null);

  await db
    .insert(paymentSettings)
    .values({
      branchId: input.branchId,
      thungngernEnabled: input.thungngernEnabled,
      promptpayId: input.promptpayId,
      qrMode,
      merchantPayload,
      provider: "slip2go",
      easyApiKeyEncrypted: apiSecretEncrypted,
      webhookTokenEncrypted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentSettings.branchId,
      set: {
        thungngernEnabled: input.thungngernEnabled,
        promptpayId: input.promptpayId,
        qrMode,
        merchantPayload,
        provider: "slip2go",
        easyApiKeyEncrypted: apiSecretEncrypted,
        webhookTokenEncrypted,
        updatedAt: new Date(),
      },
    });

  return getPaymentConfigSummary(input.branchId, { includeWebhookToken: true });
}

export type ThungngernRuntimeConfig = {
  qrMode: ThungngernQrMode;
  promptpayId: string;
  /** ข้อมูลร้านค้าถุงเงินที่ parse จาก merchantPayload (โหมด merchant เท่านั้น) */
  merchant: MerchantBillInfoView | null;
  client: Slip2GoClient;
  mockMode: boolean;
};

/**
 * client พร้อมใช้งานสำหรับตรวจสลิปเข้าถุงเงิน — คืน null ถ้ายังตั้งค่าไม่ครบ
 * โหมด promptpay ต้องมี PromptPay ID; โหมด merchant ต้องมี merchant payload ที่ parse ได้
 * ลำดับ secret: ตาราง payment_settings (เข้ารหัส) → environment fallback
 * SLIP2GO_MOCK=1 บังคับ client จำลอง (dev/test เท่านั้น)
 */
export async function getThungngernRuntimeConfig(
  branchId: number
): Promise<ThungngernRuntimeConfig | null> {
  const stored = await readStoredConfig(branchId);
  if (!stored?.thungngernEnabled) return null;
  const qrMode: ThungngernQrMode =
    stored.qrMode === "merchant" ? "merchant" : "promptpay";
  const promptpayId = stored.promptpayId.trim();
  const merchant = qrMode === "merchant" ? parseMerchantView(stored.merchantPayload) : null;
  if (qrMode === "promptpay" && !promptpayId) return null;
  if (qrMode === "merchant" && !merchant) return null;

  if (env.slip2goMock) {
    return {
      qrMode,
      promptpayId,
      merchant,
      client: createSharedMockSlip2GoClient(),
      mockMode: true,
    };
  }

  const apiSecret = stored.easyApiKeyEncrypted
    ? await decryptSecret(stored.easyApiKeyEncrypted, {
        appSecret: env.appSecret,
        keyScope: KEY_SCOPE,
        context: SECRET_CONTEXT,
      })
    : env.slip2goApiSecret;
  if (!apiSecret) return null;

  return {
    qrMode,
    promptpayId,
    merchant,
    client: createSlip2GoClient({
      baseUrl: env.slip2goBaseUrl,
      apiSecret,
      timeoutMs: env.slip2goTimeoutMs,
    }),
    mockMode: false,
  };
}

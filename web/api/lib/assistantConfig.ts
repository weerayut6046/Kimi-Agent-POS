import { eq } from "drizzle-orm";
import { assistantSettings } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

export type AssistantProvider = "ollama" | "deepseek";

export type AssistantConfigSummary = {
  provider: AssistantProvider;
  ollamaModel: string;
  deepseekModel: string;
  deepseekApiKeyConfigured: boolean;
  apiKeySource: "settings" | "environment" | "none";
  settingsSource: "settings" | "environment";
};

export type AssistantRuntimeConfig = AssistantConfigSummary & {
  deepseekApiKey: string;
  ollamaBaseUrl: string;
  ollamaTimeoutMs: number;
};

type SaveAssistantConfigInput = {
  branchId: number;
  provider: AssistantProvider;
  ollamaModel: string;
  deepseekModel: string;
  deepseekApiKey?: string;
  clearDeepseekApiKey?: boolean;
};

const SECRET_VERSION = "v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SECRET_CONTEXT = encoder.encode(
  "pump-pos:assistant:deepseek-api-key:v1",
);

export class AssistantSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantSecretError";
  }
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function encryptionKey(appSecret: string) {
  if (encoder.encode(appSecret).byteLength < 16) {
    throw new AssistantSecretError(
      "APP_SECRET ต้องยาวอย่างน้อย 16 ตัวอักษรเพื่อเข้ารหัส API Key"
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`pump-pos:assistant-secret:v1:${appSecret}`),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * API key ถูกเข้ารหัสด้วย AES-256-GCM ก่อนเขียนฐานข้อมูล
 * รูปแบบเป็น version.iv.authTag.ciphertext (base64url)
 */
export async function encryptAssistantApiKey(
  value: string,
  appSecret = env.appSecret,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: SECRET_CONTEXT,
        tagLength: 128,
      },
      await encryptionKey(appSecret),
      encoder.encode(value),
    ),
  );
  const authTag = encrypted.slice(-16);
  const ciphertext = encrypted.slice(0, -16);
  return [
    SECRET_VERSION,
    bytesToBase64Url(iv),
    bytesToBase64Url(authTag),
    bytesToBase64Url(ciphertext),
  ].join(".");
}

export async function decryptAssistantApiKey(
  payload: string,
  appSecret = env.appSecret,
): Promise<string> {
  try {
    const [version, ivValue, authTagValue, ciphertextValue, extra] =
      payload.split(".");
    if (
      version !== SECRET_VERSION ||
      !ivValue ||
      !authTagValue ||
      !ciphertextValue ||
      extra
    ) {
      throw new Error("invalid encrypted secret format");
    }
    const iv = base64UrlToBytes(ivValue);
    const authTag = base64UrlToBytes(authTagValue);
    const ciphertext = base64UrlToBytes(ciphertextValue);
    const encrypted = new Uint8Array(ciphertext.length + authTag.length);
    encrypted.set(ciphertext);
    encrypted.set(authTag, ciphertext.length);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: SECRET_CONTEXT,
        tagLength: 128,
      },
      await encryptionKey(appSecret),
      encrypted,
    );
    return decoder.decode(decrypted);
  } catch (error) {
    if (error instanceof AssistantSecretError) throw error;
    throw new AssistantSecretError(
      "ถอดรหัส DeepSeek API Key ไม่สำเร็จ กรุณาบันทึก API Key ใหม่"
    );
  }
}

function configuredProvider(value: string | undefined): AssistantProvider {
  return value === "deepseek" || value === "ollama"
    ? value
    : env.assistantProvider;
}

async function readStoredConfig(branchId: number) {
  return getDb().query.assistantSettings.findFirst({
    where: eq(assistantSettings.branchId, branchId),
  });
}

export async function getAssistantConfigSummary(
  branchId: number
): Promise<AssistantConfigSummary> {
  const stored = await readStoredConfig(branchId);
  const apiKeySource = stored?.deepseekApiKeyEncrypted
    ? "settings"
    : env.deepseekApiKey
      ? "environment"
      : "none";

  return {
    provider: configuredProvider(stored?.provider),
    ollamaModel: stored?.ollamaModel || env.ollamaModel,
    deepseekModel: stored?.deepseekModel || env.deepseekModel,
    deepseekApiKeyConfigured: apiKeySource !== "none",
    apiKeySource,
    settingsSource: stored ? "settings" : "environment",
  };
}

export async function getAssistantRuntimeConfig(
  branchId: number
): Promise<AssistantRuntimeConfig> {
  const stored = await readStoredConfig(branchId);
  const deepseekApiKey = stored?.deepseekApiKeyEncrypted
    ? await decryptAssistantApiKey(stored.deepseekApiKeyEncrypted)
    : env.deepseekApiKey;
  const apiKeySource = stored?.deepseekApiKeyEncrypted
    ? "settings"
    : deepseekApiKey
      ? "environment"
      : "none";

  return {
    provider: configuredProvider(stored?.provider),
    ollamaModel: stored?.ollamaModel || env.ollamaModel,
    deepseekModel: stored?.deepseekModel || env.deepseekModel,
    deepseekApiKey,
    deepseekApiKeyConfigured: apiKeySource !== "none",
    apiKeySource,
    settingsSource: stored ? "settings" : "environment",
    ollamaBaseUrl: env.ollamaBaseUrl,
    ollamaTimeoutMs: env.ollamaTimeoutMs,
  };
}

export async function saveAssistantConfig(
  input: SaveAssistantConfigInput
): Promise<AssistantConfigSummary> {
  const db = getDb();
  const existing = await readStoredConfig(input.branchId);
  const deepseekApiKeyEncrypted = input.clearDeepseekApiKey
    ? null
    : input.deepseekApiKey
      ? await encryptAssistantApiKey(input.deepseekApiKey)
      : (existing?.deepseekApiKeyEncrypted ?? null);

  await db
    .insert(assistantSettings)
    .values({
      branchId: input.branchId,
      provider: input.provider,
      ollamaModel: input.ollamaModel,
      deepseekModel: input.deepseekModel,
      deepseekApiKeyEncrypted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: assistantSettings.branchId,
      set: {
        provider: input.provider,
        ollamaModel: input.ollamaModel,
        deepseekModel: input.deepseekModel,
        deepseekApiKeyEncrypted,
        updatedAt: new Date(),
      },
    });

  return getAssistantConfigSummary(input.branchId);
}

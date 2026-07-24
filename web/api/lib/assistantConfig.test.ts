import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCipheriv, createHash } from "node:crypto";
import { assistantSettings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import {
  decryptAssistantApiKey,
  encryptAssistantApiKey,
} from "./assistantConfig";

let t: TestDb;

function legacyEncryptedApiKey(value: string, appSecret: string): string {
  const iv = Buffer.alloc(12, 7);
  const key = createHash("sha256")
    .update("pump-pos:assistant-secret:v1:", "utf8")
    .update(appSecret, "utf8")
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(
    Buffer.from("pump-pos:assistant:deepseek-api-key:v1", "utf8"),
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

beforeAll(async () => {
  t = await setupTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => t.cleanup());

describe("assistant configuration", () => {
  it("เข้ารหัส API Key แบบ authenticated encryption และถอดกลับได้", async () => {
    const appSecret = "test-app-secret-with-enough-entropy";
    const encrypted = await encryptAssistantApiKey(
      "sk-secret-value",
      appSecret,
    );

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sk-secret-value");
    await expect(decryptAssistantApiKey(encrypted, appSecret)).resolves.toBe(
      "sk-secret-value"
    );
    await expect(
      decryptAssistantApiKey(encrypted, "a-different-long-app-secret")
    ).rejects.toThrow("ถอดรหัส DeepSeek API Key ไม่สำเร็จ");
  });

  it("ถอดรหัส API Key รูปแบบเดิมจาก Node runtime ได้", async () => {
    const appSecret = "test-app-secret-with-enough-entropy";
    const encrypted = legacyEncryptedApiKey(
      "sk-existing-production-value",
      appSecret,
    );

    await expect(decryptAssistantApiKey(encrypted, appSecret)).resolves.toBe(
      "sk-existing-production-value",
    );
  });

  it("ให้เฉพาะ admin ตั้งค่าและไม่คืน API Key กลับไปยัง client", async () => {
    await expect(t.caller("manager").assistant.config()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );

    const result = await t.caller("admin").assistant.updateConfig({
      provider: "deepseek",
      ollamaModel: "qwen3:8b",
      deepseekModel: "deepseek-v4-flash",
      deepseekApiKey: "sk-user-configured-secret",
    });

    expect(result.ok).toBe(true);
    expect(result.config.provider).toBe("deepseek");
    expect(result.config.deepseekApiKeyConfigured).toBe(true);
    expect(result.config.apiKeySource).toBe("settings");
    expect(JSON.stringify(result)).not.toContain("sk-user-configured-secret");

    const [stored] = await t.db.select().from(assistantSettings);
    expect(stored?.deepseekApiKeyEncrypted).toMatch(/^v1\./);
    expect(stored?.deepseekApiKeyEncrypted).not.toContain(
      "sk-user-configured-secret"
    );

    await expect(
      t.caller("cashier").assistant.updateConfig({
        provider: "ollama",
        ollamaModel: "qwen3:4b-instruct",
        deepseekModel: "deepseek-v4-flash",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });

  it("ใช้ provider, model และ API Key ที่ตั้งจากหน้า Settings ตอนแชต", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "ตั้งค่าถูกใช้แล้ว" } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("cashier").assistant.chat({
      messages: [{ role: "user", content: "ทดสอบการตั้งค่า AI" }],
    });

    expect(result.answer).toBe("ตั้งค่าถูกใช้แล้ว");
    const request = fetchMock.mock.calls[0];
    const headers = new Headers(request[1]?.headers);
    const body = JSON.parse(String(request[1]?.body));
    expect(headers.get("Authorization")).toBe(
      "Bearer sk-user-configured-secret"
    );
    expect(body.model).toBe("deepseek-v4-flash");
  });
});

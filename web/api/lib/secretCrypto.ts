/**
 * เข้ารหัส/ถอดรหัส secret ฝั่งเซิร์ฟเวอร์ด้วย AES-256-GCM (คีย์สืบจาก APP_SECRET)
 * รูปแบบ ciphertext: v1.<iv>.<authTag>.<ciphertext> (base64url)
 * context แยกตามวัตถุประสงค์ เพื่อไม่ให้ ciphertext ข้ามระบบกันใช้ได้
 */

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretCryptoError";
  }
}

const SECRET_VERSION = "v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

async function encryptionKey(appSecret: string, keyScope: string) {
  if (encoder.encode(appSecret).byteLength < 16) {
    throw new SecretCryptoError(
      "APP_SECRET ต้องยาวอย่างน้อย 16 ตัวอักษรเพื่อเข้ารหัส secret"
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${keyScope}:${appSecret}`)
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(
  value: string,
  options: { appSecret: string; keyScope: string; context: string }
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(options.context),
        tagLength: 128,
      },
      await encryptionKey(options.appSecret, options.keyScope),
      encoder.encode(value)
    )
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

export async function decryptSecret(
  payload: string,
  options: { appSecret: string; keyScope: string; context: string },
  failureMessage = "ถอดรหัส secret ไม่สำเร็จ กรุณาบันทึกค่าใหม่"
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
        additionalData: encoder.encode(options.context),
        tagLength: 128,
      },
      await encryptionKey(options.appSecret, options.keyScope),
      encrypted
    );
    return decoder.decode(decrypted);
  } catch (error) {
    if (error instanceof SecretCryptoError) throw error;
    throw new SecretCryptoError(failureMessage);
  }
}

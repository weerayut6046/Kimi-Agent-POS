import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;
const PREFIX = "local-scrypt-v1";

/** Password storage used only by the explicitly enabled self-hosted dev mode. */
export async function hashLocalPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${PREFIX}:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyLocalPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [prefix, encodedSalt, encodedHash, extra] = stored.split(":");
  if (prefix === PREFIX && encodedSalt && encodedHash && !extra) {
    try {
      const expected = Buffer.from(encodedHash, "base64url");
      const actual = (await scryptAsync(
        password,
        Buffer.from(encodedSalt, "base64url"),
        expected.length
      )) as Buffer;
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    } catch {
      return false;
    }
  }

  // Existing integration-test fixtures use the historical SHA-256 PIN format.
  if (process.env.NODE_ENV === "test" && /^[a-f0-9]{64}$/i.test(stored)) {
    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256").update(password).digest();
    const expected = Buffer.from(stored, "hex");
    return timingSafeEqual(expected, actual);
  }

  return false;
}

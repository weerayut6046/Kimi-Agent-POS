import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { env } from "./env";
import { verifyLocalPassword } from "./localPassword";

const PIN_PREFIX = "staff-pin-hmac-v1";
const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export const STAFF_PIN_PATTERN = /^\d{4,6}$/;

function pinDigest(pin: string): string {
  return createHmac("sha256", env.appSecret)
    .update(`pumppos:staff-pin:${pin}`)
    .digest("base64url");
}

/**
 * PINs have a very small key space, so a standalone password hash can still be
 * brute-forced after a database leak. Key the digest with APP_SECRET instead;
 * the database alone is then insufficient to recover or test PIN values.
 */
export function hashStaffPin(pin: string): string {
  if (!STAFF_PIN_PATTERN.test(pin)) {
    throw new Error("PIN ต้องเป็นตัวเลข 4-6 หลัก");
  }
  return `${PIN_PREFIX}:${pinDigest(pin)}`;
}

export function isLegacyStaffPinHash(stored: string): boolean {
  return LEGACY_SHA256_PATTERN.test(stored);
}

/**
 * Verify the historical unsalted SHA-256 format only so a successful login
 * can replace it with the keyed digest. Callers must persist hashStaffPin(pin)
 * immediately after a match; this is a compatibility bridge, not a storage
 * format for new or reset PINs.
 */
export function verifyLegacyStaffPin(pin: string, stored: string): boolean {
  if (!STAFF_PIN_PATTERN.test(pin) || !isLegacyStaffPinHash(stored)) {
    return false;
  }
  const expected = Buffer.from(stored, "hex");
  const actual = createHash("sha256").update(pin).digest();
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

export async function verifyStaffPin(
  pin: string,
  stored: string
): Promise<boolean> {
  if (!STAFF_PIN_PATTERN.test(pin)) return false;
  const [prefix, encodedDigest, extra] = stored.split(":");
  if (prefix === PIN_PREFIX && encodedDigest && extra === undefined) {
    const expected = Buffer.from(encodedDigest);
    const actual = Buffer.from(pinDigest(pin));
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  if (process.env.NODE_ENV === "test" && verifyLegacyStaffPin(pin, stored)) {
    return true;
  }

  // Keep existing Local Dev and integration-test accounts usable until an
  // administrator resets their PIN from the staff settings screen.
  return verifyLocalPassword(pin, stored);
}

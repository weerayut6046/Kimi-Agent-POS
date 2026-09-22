import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { env } from "./env";

const PROOF_TTL_SECONDS = 12 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(payload: string): string {
  return createHmac("sha256", env.appSecret)
    .update(`pumppos:face-session:v1:${payload}`)
    .digest("base64url");
}

export function issueFaceSessionProof(
  userId: string,
  sessionId: string,
  nowSeconds = Math.floor(Date.now() / 1_000)
): string {
  if (!UUID.test(userId) || !UUID.test(sessionId)) {
    throw new Error("Supabase session has no valid identity");
  }
  const payload = Buffer.from(JSON.stringify({
    sub: userId, sid: sessionId, exp: nowSeconds + PROOF_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyFaceSessionProof(
  token: string | null,
  userId: string,
  sessionId: string,
  nowSeconds = Math.floor(Date.now() / 1_000)
): boolean {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown; sid?: unknown; exp?: unknown;
    };
    return claims.sub === userId && claims.sid === sessionId &&
      typeof claims.exp === "number" && claims.exp > nowSeconds &&
      claims.exp <= nowSeconds + PROOF_TTL_SECONDS;
  } catch {
    return false;
  }
}

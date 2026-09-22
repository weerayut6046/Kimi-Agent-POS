import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "./env";

const LOGIN_FACE_TOKEN_PREFIX = "PUMPLOGINFACE1";
const FACE_TOKEN_TTL_SECONDS = 180;
const MAX_FACE_TOKEN_TTL_SECONDS = 240;

export type FaceLivenessAction = "blink" | "turn_left" | "turn_right";
export type LoginFaceClaims = {
  version: 1;
  branchId: number;
  staffId: number;
  nonce: string;
  livenessAction: FaceLivenessAction;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret(): string {
  if (env.appSecret.length < 32)
    throw new Error("APP_SECRET must be at least 32 characters");
  return env.appSecret;
}

function signLoginFace(payload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`${LOGIN_FACE_TOKEN_PREFIX}.${payload}`)
    .digest("base64url");
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url payload");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function issueLoginFaceToken(
  input: { branchId: number; staffId: number },
  now = new Date()
): { token: string; expiresAt: Date; livenessAction: FaceLivenessAction } {
  if (
    !Number.isInteger(input.branchId) ||
    input.branchId <= 0 ||
    !Number.isInteger(input.staffId) ||
    input.staffId <= 0
  ) {
    throw new Error("ข้อมูลพนักงานสำหรับสร้างคำทดสอบใบหน้าไม่ถูกต้อง");
  }
  const actions: FaceLivenessAction[] = ["blink", "turn_left", "turn_right"];
  const livenessAction = actions[(randomBytes(1)[0] ?? 0) % actions.length]!;
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: LoginFaceClaims = {
    version: 1,
    branchId: input.branchId,
    staffId: input.staffId,
    nonce: randomBytes(18).toString("base64url"),
    livenessAction,
    issuedAt,
    expiresAt: issuedAt + FACE_TOKEN_TTL_SECONDS,
  };
  const payload = encodeBase64Url(JSON.stringify(claims));
  return {
    token: `${LOGIN_FACE_TOKEN_PREFIX}.${payload}.${signLoginFace(payload)}`,
    expiresAt: new Date(claims.expiresAt * 1_000),
    livenessAction,
  };
}

export function verifyLoginFaceToken(
  token: string,
  now = new Date()
): LoginFaceClaims {
  const [prefix, payload, signature, extra] = token.split(".");
  if (
    prefix !== LOGIN_FACE_TOKEN_PREFIX ||
    !payload ||
    !signature ||
    extra !== undefined
  ) {
    throw new Error("คำทดสอบใบหน้ามีรูปแบบไม่ถูกต้อง");
  }
  const encoder = new TextEncoder();
  const expected = encoder.encode(signLoginFace(payload));
  const supplied = encoder.encode(signature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("คำทดสอบใบหน้าไม่ถูกต้องหรือถูกแก้ไข");
  }
  let claims: Partial<LoginFaceClaims>;
  try {
    claims = JSON.parse(decodeBase64Url(payload)) as Partial<LoginFaceClaims>;
  } catch {
    throw new Error("อ่านคำทดสอบใบหน้าไม่สำเร็จ");
  }
  if (
    claims.version !== 1 ||
    !Number.isInteger(claims.branchId) ||
    Number(claims.branchId) <= 0 ||
    !Number.isInteger(claims.staffId) ||
    Number(claims.staffId) <= 0 ||
    typeof claims.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(claims.nonce) ||
    !(["blink", "turn_left", "turn_right"] as unknown[]).includes(
      claims.livenessAction
    ) ||
    !Number.isInteger(claims.issuedAt) ||
    !Number.isInteger(claims.expiresAt) ||
    Number(claims.expiresAt) <= Number(claims.issuedAt) ||
    Number(claims.expiresAt) - Number(claims.issuedAt) >
      MAX_FACE_TOKEN_TTL_SECONDS
  ) {
    throw new Error("ข้อมูลภายในคำทดสอบใบหน้าไม่ถูกต้อง");
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    Number(claims.issuedAt) > nowSeconds + 5 ||
    Number(claims.expiresAt) <= nowSeconds
  ) {
    throw new Error("คำทดสอบใบหน้าหมดอายุ กรุณากรอก PIN ใหม่");
  }
  return claims as LoginFaceClaims;
}

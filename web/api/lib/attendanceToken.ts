import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "./env";

const TOKEN_PREFIX = "PUMPATT1";
const TOKEN_TTL_SECONDS = 45;
const MAX_TOKEN_TTL_SECONDS = 90;

export type AttendanceQrClaims = {
  version: 1;
  branchId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret(): string {
  if (env.appSecret.length < 32) {
    throw new Error("ยังไม่ได้ตั้งค่า APP_SECRET สำหรับลงนาม QR ลงเวลาทำงาน");
  }
  return env.appSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`${TOKEN_PREFIX}.${payload}`)
    .digest("base64url");
}

export function issueAttendanceQrToken(
  branchId: number,
  now = new Date()
): { token: string; expiresAt: Date } {
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new Error("สาขาสำหรับสร้าง QR ไม่ถูกต้อง");
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims: AttendanceQrClaims = {
    version: 1,
    branchId,
    nonce: randomBytes(18).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    token: `${TOKEN_PREFIX}.${payload}.${sign(payload)}`,
    expiresAt: new Date(claims.expiresAt * 1000),
  };
}

export function verifyAttendanceQrToken(
  token: string,
  now = new Date()
): AttendanceQrClaims {
  const [prefix, payload, suppliedSignature, extra] = token.split(".");
  if (
    prefix !== TOKEN_PREFIX ||
    !payload ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    throw new Error("QR ลงเวลามีรูปแบบไม่ถูกต้อง");
  }

  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("QR ลงเวลาไม่ถูกต้องหรือถูกแก้ไข");
  }

  let claims: Partial<AttendanceQrClaims>;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<AttendanceQrClaims>;
  } catch {
    throw new Error("อ่านข้อมูล QR ลงเวลาไม่สำเร็จ");
  }

  if (
    claims.version !== 1 ||
    !Number.isInteger(claims.branchId) ||
    Number(claims.branchId) <= 0 ||
    typeof claims.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(claims.nonce) ||
    !Number.isInteger(claims.issuedAt) ||
    !Number.isInteger(claims.expiresAt) ||
    Number(claims.expiresAt) <= Number(claims.issuedAt) ||
    Number(claims.expiresAt) - Number(claims.issuedAt) > MAX_TOKEN_TTL_SECONDS
  ) {
    throw new Error("ข้อมูลภายใน QR ลงเวลาไม่ถูกต้อง");
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Number(claims.issuedAt) > nowSeconds + 5) {
    throw new Error("QR ลงเวลาถูกสร้างจากเวลาที่ไม่ถูกต้อง");
  }
  if (Number(claims.expiresAt) <= nowSeconds) {
    throw new Error("QR ลงเวลาหมดอายุแล้ว กรุณาสแกน QR ใหม่");
  }

  return claims as AttendanceQrClaims;
}

export function attendanceQrIdempotencyKey(
  claims: AttendanceQrClaims,
  staffId: number
): string {
  return `qr:${createHash("sha256")
    .update(`${claims.branchId}:${claims.nonce}:${staffId}`)
    .digest("hex")}`;
}

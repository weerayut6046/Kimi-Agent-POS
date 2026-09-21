import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "./env";

const TOKEN_PREFIX = "PUMPATT1";
const TOKEN_TTL_SECONDS = 45;
const MAX_TOKEN_TTL_SECONDS = 90;
const FACE_TOKEN_PREFIX = "PUMPFACE1";
const FACE_TOKEN_TTL_SECONDS = 180;
const MAX_FACE_TOKEN_TTL_SECONDS = 240;

export type AttendanceAction = "clock_in" | "clock_out";
export type FaceLivenessAction = "blink" | "turn_left" | "turn_right";

export type AttendanceQrClaims = {
  version: 1;
  branchId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export type AttendanceFaceClaims = {
  version: 1;
  branchId: number;
  staffId: number;
  qrNonce: string;
  nonce: string;
  attendanceAction: AttendanceAction;
  livenessAction: FaceLivenessAction;
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

function signFace(payload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`${FACE_TOKEN_PREFIX}.${payload}`)
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
  const payload = encodeBase64Url(JSON.stringify(claims));
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

  const encoder = new TextEncoder();
  const expected = encoder.encode(sign(payload));
  const supplied = encoder.encode(suppliedSignature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("QR ลงเวลาไม่ถูกต้องหรือถูกแก้ไข");
  }

  let claims: Partial<AttendanceQrClaims>;
  try {
    claims = JSON.parse(
      decodeBase64Url(payload)
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

export function issueAttendanceFaceToken(
  input: {
    qrClaims: AttendanceQrClaims;
    staffId: number;
    attendanceAction: AttendanceAction;
  },
  now = new Date()
): { token: string; expiresAt: Date; livenessAction: FaceLivenessAction } {
  if (!Number.isInteger(input.staffId) || input.staffId <= 0) {
    throw new Error("พนักงานสำหรับสร้างคำทดสอบใบหน้าไม่ถูกต้อง");
  }
  const actions: FaceLivenessAction[] = ["blink", "turn_left", "turn_right"];
  const random = randomBytes(1)[0] ?? 0;
  const livenessAction = actions[random % actions.length]!;
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: AttendanceFaceClaims = {
    version: 1,
    branchId: input.qrClaims.branchId,
    staffId: input.staffId,
    qrNonce: input.qrClaims.nonce,
    nonce: randomBytes(18).toString("base64url"),
    attendanceAction: input.attendanceAction,
    livenessAction,
    issuedAt,
    expiresAt: issuedAt + FACE_TOKEN_TTL_SECONDS,
  };
  const payload = encodeBase64Url(JSON.stringify(claims));
  return {
    token: `${FACE_TOKEN_PREFIX}.${payload}.${signFace(payload)}`,
    expiresAt: new Date(claims.expiresAt * 1_000),
    livenessAction,
  };
}

export function verifyAttendanceFaceToken(
  token: string,
  now = new Date()
): AttendanceFaceClaims {
  const [prefix, payload, suppliedSignature, extra] = token.split(".");
  if (
    prefix !== FACE_TOKEN_PREFIX ||
    !payload ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    throw new Error("คำทดสอบใบหน้ามีรูปแบบไม่ถูกต้อง");
  }
  const encoder = new TextEncoder();
  const expected = encoder.encode(signFace(payload));
  const supplied = encoder.encode(suppliedSignature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("คำทดสอบใบหน้าไม่ถูกต้องหรือถูกแก้ไข");
  }

  let claims: Partial<AttendanceFaceClaims>;
  try {
    claims = JSON.parse(
      decodeBase64Url(payload)
    ) as Partial<AttendanceFaceClaims>;
  } catch {
    throw new Error("อ่านคำทดสอบใบหน้าไม่สำเร็จ");
  }
  const validActions: AttendanceAction[] = ["clock_in", "clock_out"];
  const validLivenessActions: FaceLivenessAction[] = [
    "blink",
    "turn_left",
    "turn_right",
  ];
  if (
    claims.version !== 1 ||
    !Number.isInteger(claims.branchId) ||
    Number(claims.branchId) <= 0 ||
    !Number.isInteger(claims.staffId) ||
    Number(claims.staffId) <= 0 ||
    typeof claims.qrNonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(claims.qrNonce) ||
    typeof claims.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(claims.nonce) ||
    !validActions.includes(claims.attendanceAction as AttendanceAction) ||
    !validLivenessActions.includes(
      claims.livenessAction as FaceLivenessAction
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
  if (Number(claims.issuedAt) > nowSeconds + 5) {
    throw new Error("คำทดสอบใบหน้าถูกสร้างจากเวลาที่ไม่ถูกต้อง");
  }
  if (Number(claims.expiresAt) <= nowSeconds) {
    throw new Error("คำทดสอบใบหน้าหมดอายุแล้ว กรุณาสแกน QR ใหม่");
  }
  return claims as AttendanceFaceClaims;
}

export function attendanceFaceIdempotencyKey(
  claims: AttendanceFaceClaims
): string {
  return `face:${createHash("sha256")
    .update(`${claims.branchId}:${claims.qrNonce}:${claims.staffId}`)
    .digest("hex")}`;
}

import { createHmac, timingSafeEqual } from "crypto";
import { env } from "./env";

export type StaffSessionClaims = {
  id: number;
  name: string;
  role: "admin" | "manager" | "cashier";
  username: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  exp: number;
};

const SESSION_HEADER = "x-staff-session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function sign(payload: string): string {
  return createHmac("sha256", env.appSecret).update(payload).digest("base64url");
}

export function issueStaffSession(
  staff: Omit<
    StaffSessionClaims,
    "exp" | "branchId" | "branchCode" | "branchName"
  > &
    Partial<
      Pick<StaffSessionClaims, "branchId" | "branchCode" | "branchName">
    >,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...staff,
      // Tokens issued before multi-branch support remain valid for the main
      // branch during the staged web/Desktop rollout.
      branchId: staff.branchId ?? 1,
      branchCode: staff.branchCode ?? "MAIN",
      branchName: staff.branchName ?? "สาขาหลัก",
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function staffSessionFromHeader(req: Request): StaffSessionClaims | null {
  const token = req.headers.get(SESSION_HEADER);
  if (!token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return null;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<StaffSessionClaims>;
    const branchId = claims.branchId ?? 1;
    if (
      !Number.isInteger(claims.id) ||
      Number(claims.id) <= 0 ||
      typeof claims.name !== "string" ||
      typeof claims.username !== "string" ||
      !["admin", "manager", "cashier"].includes(String(claims.role)) ||
      !Number.isInteger(branchId) ||
      Number(branchId) <= 0 ||
      !Number.isFinite(claims.exp) ||
      Number(claims.exp) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      ...(claims as StaffSessionClaims),
      branchId: Number(branchId),
      branchCode:
        typeof claims.branchCode === "string" ? claims.branchCode : "MAIN",
      branchName:
        typeof claims.branchName === "string"
          ? claims.branchName
          : "สาขาหลัก",
    };
  } catch {
    return null;
  }
}

export function branchIdFromRequest(req: Request): number {
  return staffSessionFromHeader(req)?.branchId ?? 1;
}

export const LOGIN_SERVICE_ERROR_MESSAGE =
  "ระบบเข้าสู่ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ";

type LoginErrorDetails = {
  message?: unknown;
  code?: unknown;
  name?: unknown;
  data?: { code?: unknown; httpStatus?: unknown };
  shape?: { data?: { code?: unknown; httpStatus?: unknown } };
  cause?: { name?: unknown };
};

// Older APIs can expose a database exception without tRPC error metadata.
const databaseErrorPattern =
  /\b(?:failed query|sql(?:state)?|postgres(?:ql)?|drizzle\w*|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|\bparams\s*:|\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\b(?:database|db)\s+(?:error|query|connection|failure|unavailable)\b|\b(?:column|relation|table)\b[\s\S]*\bdoes not exist\b|\bpermission denied for (?:table|schema|database)\b|\bpassword authentication failed for user\b/i;

/** Keep expected login errors useful while hiding server/database details. */
export function loginErrorMessage(
  error: unknown,
  fallback = "เข้าสู่ระบบไม่สำเร็จ"
): string {
  if (!error || typeof error !== "object") return fallback;
  const details = error as LoginErrorDetails;
  const data = details.data ?? details.shape?.data;
  if (
    details.code === "INTERNAL_SERVER_ERROR" ||
    details.code === -32603 ||
    data?.code === "INTERNAL_SERVER_ERROR" ||
    (typeof data?.httpStatus === "number" && data.httpStatus >= 500)
  ) {
    return LOGIN_SERVICE_ERROR_MESSAGE;
  }

  const message =
    typeof details.message === "string" ? details.message.trim() : "";
  if (databaseErrorPattern.test(message)) return LOGIN_SERVICE_ERROR_MESSAGE;

  // Preserve passkey messages already translated by the caller.
  if (/[\u0E00-\u0E7F]/.test(message)) return message;
  if (
    details.code === "ERROR_CEREMONY_ABORTED" ||
    [details.name, details.cause?.name].some(
      name => name === "NotAllowedError" || name === "AbortError"
    )
  ) {
    return "ยกเลิกการยืนยันตัวตนหรือหมดเวลา กรุณาลองใหม่";
  }
  return message || fallback;
}

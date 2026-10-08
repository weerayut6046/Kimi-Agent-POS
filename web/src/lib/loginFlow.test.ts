import { describe, expect, it } from "vitest";
import { LOGIN_SERVICE_ERROR_MESSAGE, loginErrorMessage } from "./loginFlow";

describe("loginErrorMessage", () => {
  it.each([
    { code: "INTERNAL_SERVER_ERROR" },
    { code: -32603 },
    { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    { data: { httpStatus: 503 } },
    { shape: { data: { code: "INTERNAL_SERVER_ERROR" } } },
  ])(
    "hides internal server errors even with a friendly message: %j",
    metadata => {
      expect(
        loginErrorMessage({ message: "รายละเอียดจากเซิร์ฟเวอร์", ...metadata })
      ).toBe(LOGIN_SERVICE_ERROR_MESSAGE);
    }
  );

  it.each([
    'Failed query: select "id" from "staff_users"\nparams: synthetic-login-user',
    'select "auth_user_id" from "staff_users" where "username" = $1',
    'SQLSTATE 42703: column "auth_user_id" does not exist',
    'relation "staff_users" does not exist',
    "Database connection unavailable: synthetic-host",
    'permission denied for table "staff_users"',
    'password authentication failed for user "synthetic-db-user"',
    "params: synthetic-login-user",
    "DrizzleQueryError: synthetic database failure",
  ])("hides legacy database error details: %s", message => {
    expect(loginErrorMessage(new Error(message))).toBe(
      LOGIN_SERVICE_ERROR_MESSAGE
    );
  });

  it.each([
    ["UNAUTHORIZED", "ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง"],
    [
      "PRECONDITION_FAILED",
      "บัญชีนี้ยังไม่พร้อมเข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบ",
    ],
    ["TOO_MANY_REQUESTS", "กรอก PIN ผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่"],
    ["BAD_REQUEST", "กรุณากรอก PIN เป็นตัวเลข 4–6 หลัก"],
  ])("preserves expected %s authentication feedback", (code, message) => {
    expect(
      loginErrorMessage({ message, data: { code, httpStatus: 400 } })
    ).toBe(message);
  });

  it.each([
    "ยกเลิกการยืนยันตัวตน กรุณาลองใหม่",
    "สร้างเซสชันเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่",
  ])("preserves translated passkey and session errors: %s", message => {
    expect(loginErrorMessage(new Error(message))).toBe(message);
  });

  it.each([
    { name: "NotAllowedError" },
    { name: "AbortError" },
    { code: "ERROR_CEREMONY_ABORTED" },
    {
      name: "WebAuthnError",
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: { name: "NotAllowedError" },
    },
  ])("translates browser and WebAuthn cancellation: %j", metadata => {
    expect(
      loginErrorMessage({ message: "The operation was cancelled", ...metadata })
    ).toBe("ยกเลิกการยืนยันตัวตนหรือหมดเวลา กรุณาลองใหม่");
  });

  it("uses the caller's fallback when no error message is available", () => {
    expect(loginErrorMessage(null, "ยืนยันตัวตนไม่สำเร็จ")).toBe(
      "ยืนยันตัวตนไม่สำเร็จ"
    );
    expect(loginErrorMessage({ message: "  " })).toBe("เข้าสู่ระบบไม่สำเร็จ");
  });
});

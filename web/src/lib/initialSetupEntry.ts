import {
  createInitialOwnerInput,
  type InitialSetupState,
} from "@contracts/initialSetup";
import { LOGIN_SERVICE_ERROR_MESSAGE, loginErrorMessage } from "./loginFlow";

export type InitialEntry =
  | "session_check"
  | "authenticated"
  | "installation_check"
  | "installation_error"
  | "system_setup"
  | "owner_setup"
  | "login";

export function resolveInitialEntry(input: {
  hasStaff: boolean;
  checkingSession: boolean;
  state?: InitialSetupState;
  loading: boolean;
  error: boolean;
  fetchedAfterMount: boolean;
}): InitialEntry {
  if (input.checkingSession) return "session_check";
  if (input.hasStaff) return "authenticated";
  if (input.error) return "installation_error";
  if (input.loading || !input.fetchedAfterMount) return "installation_check";
  if (
    !input.state ||
    [
      input.state.needsOwner,
      input.state.canCreateOwner,
      input.state.requiresInstallationCode,
      input.state.requiresFace,
    ].some(value => typeof value !== "boolean")
  )
    return "installation_error";
  if (input.state.systemReady === false) return "system_setup";
  return input.state.needsOwner ? "owner_setup" : "login";
}

export function initialInstallationCode(hash: string): string {
  const value =
    new URLSearchParams(hash.replace(/^#/, "")).get("install") ?? "";
  return value.length <= 256 ? value : "";
}

export function withoutInstallationCode(hash: string): string {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  if (!parameters.has("install")) return hash;
  parameters.delete("install");
  const remaining = parameters.toString();
  return remaining ? `#${remaining}` : "";
}

export type InitialOwnerForm = {
  name: string;
  username: string;
  pin: string;
  pinConfirmation: string;
  installationCode: string;
  consentConfirmed: boolean;
  embeddings?: number[][];
};

export function initialOwnerInput(
  form: InitialOwnerForm,
  state: InitialSetupState,
  requestId: string
) {
  if (state.systemReady === false || !state.needsOwner || !state.canCreateOwner)
    throw new Error("ระบบยังไม่พร้อมสร้างบัญชีเจ้าของ กรุณาติดต่อผู้ติดตั้ง");
  if (form.pin !== form.pinConfirmation)
    throw new Error("PIN และช่องยืนยัน PIN ไม่ตรงกัน");
  if (state.requiresInstallationCode && !form.installationCode.trim())
    throw new Error("กรุณาเปิดลิงก์ติดตั้งจากผู้ให้บริการ หรือระบุรหัสติดตั้ง");
  if (state.requiresFace && (!form.embeddings || !form.consentConfirmed))
    throw new Error("กรุณายินยอมและลงทะเบียนใบหน้าของเจ้าของก่อนสร้างบัญชี");
  const parsed = createInitialOwnerInput.safeParse({
    requestId,
    name: form.name,
    username: form.username,
    pin: form.pin,
    ...(form.installationCode.trim()
      ? { installationCode: form.installationCode.trim() }
      : {}),
    ...(form.embeddings
      ? { embeddings: form.embeddings, consentConfirmed: form.consentConfirmed }
      : {}),
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    throw new Error(
      message && /[\u0E00-\u0E7F]/.test(message)
        ? message
        : "ตรวจข้อมูลเจ้าของและข้อมูลใบหน้าอีกครั้ง"
    );
  }
  return parsed.data;
}

export function initialSetupErrorMessage(
  error: unknown,
  secrets: string[] = []
): string {
  const resolved = loginErrorMessage(error, "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
  const friendly =
    resolved === LOGIN_SERVICE_ERROR_MESSAGE
      ? "ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อผู้ให้บริการ"
      : resolved;
  let message = /[\u0E00-\u0E7F]/.test(friendly)
    ? friendly
    : "ทำรายการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ติดตั้ง";
  for (const secret of secrets
    .filter(value => value.length >= 4)
    .sort((a, b) => b.length - a.length)) {
    message = message
      .replaceAll(secret, "[ซ่อนข้อมูล]")
      .replaceAll(encodeURIComponent(secret), "[ซ่อนข้อมูล]");
  }
  return message;
}

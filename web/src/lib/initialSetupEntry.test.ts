import { describe, expect, it } from "vitest";
import {
  initialInstallationCode,
  initialOwnerInput,
  initialSetupErrorMessage,
  resolveInitialEntry,
  withoutInstallationCode,
  type InitialOwnerForm,
} from "./initialSetupEntry";

const fresh = {
  needsOwner: true,
  canCreateOwner: true,
  requiresInstallationCode: true,
  requiresFace: true,
};
const status = {
  hasStaff: false,
  checkingSession: false,
  state: fresh,
  loading: false,
  error: false,
  fetchedAfterMount: true,
};
const form: InitialOwnerForm = {
  name: "เจ้าของ",
  username: "OWNER",
  pin: "123456",
  pinConfirmation: "123456",
  installationCode: "example-install-code",
  consentConfirmed: true,
  embeddings: Array.from({ length: 3 }, () => Array(128).fill(0.1)),
};
const requestId = "643d1f13-8096-49a5-9c15-280da6bbf1a1";

describe("initial installation entry", () => {
  it("uses authoritative pristine state rather than browser session absence", () => {
    expect(resolveInitialEntry(status)).toBe("owner_setup");
    expect(
      resolveInitialEntry({ ...status, state: { ...fresh, needsOwner: false } })
    ).toBe("login");
  });
  it("does not accept old cached installation state or failed reads as pristine", () => {
    expect(resolveInitialEntry({ ...status, fetchedAfterMount: false })).toBe(
      "installation_check"
    );
    expect(resolveInitialEntry({ ...status, error: true })).toBe(
      "installation_error"
    );
    expect(resolveInitialEntry({ ...status, state: undefined })).toBe(
      "installation_error"
    );
  });
  it("keeps existing authenticated sessions out of bootstrap", () => {
    expect(
      resolveInitialEntry({ ...status, hasStaff: true, error: true })
    ).toBe("authenticated");
    expect(resolveInitialEntry({ ...status, checkingSession: true })).toBe(
      "session_check"
    );
  });
  it("requires system preparation before owner or login decisions when database is unavailable", () => {
    expect(
      resolveInitialEntry({
        ...status,
        state: { ...fresh, systemReady: false },
      })
    ).toBe("system_setup");
    expect(
      resolveInitialEntry({
        ...status,
        state: { ...fresh, needsOwner: false, systemReady: false },
      })
    ).toBe("system_setup");
    expect(
      resolveInitialEntry({
        ...status,
        hasStaff: true,
        state: { ...fresh, systemReady: false },
      })
    ).toBe("authenticated");
    expect(() =>
      initialOwnerInput(form, { ...fresh, systemReady: false }, requestId)
    ).toThrow("ยังไม่พร้อม");
  });
  it("reads private installation code and removes only its hash parameter", () => {
    expect(initialInstallationCode("#install=example%2Bcode&tab=owner")).toBe(
      "example+code"
    );
    expect(withoutInstallationCode("#install=example%2Bcode&tab=owner")).toBe(
      "#tab=owner"
    );
    expect(withoutInstallationCode("#section")).toBe("#section");
    expect(initialInstallationCode(`#install=${"x".repeat(257)}`)).toBe("");
  });
});

describe("initial owner form", () => {
  it("uses a stable request identifier and normalized username without extra metadata", () => {
    const input = initialOwnerInput(form, fresh, requestId);
    expect(input.requestId).toBe(requestId);
    expect(input.username).toBe("owner");
    expect(input).not.toHaveProperty("pinConfirmation");
  });
  it("rejects unavailable setup, missing installation code and mismatched PIN", () => {
    expect(() =>
      initialOwnerInput(form, { ...fresh, canCreateOwner: false }, requestId)
    ).toThrow("ยังไม่พร้อม");
    expect(() =>
      initialOwnerInput({ ...form, installationCode: "" }, fresh, requestId)
    ).toThrow("รหัสติดตั้ง");
    expect(() =>
      initialOwnerInput(
        { ...form, pinConfirmation: "654321" },
        fresh,
        requestId
      )
    ).toThrow("ไม่ตรงกัน");
  });
  it("requires explicit production face consent and valid samples", () => {
    expect(() =>
      initialOwnerInput({ ...form, consentConfirmed: false }, fresh, requestId)
    ).toThrow("ยินยอม");
    expect(() =>
      initialOwnerInput({ ...form, embeddings: undefined }, fresh, requestId)
    ).toThrow("ใบหน้า");
    expect(() =>
      initialOwnerInput({ ...form, embeddings: [[0.1]] }, fresh, requestId)
    ).toThrow("ข้อมูลใบหน้า");
  });
  it("allows explicit development setup without face or installation code", () => {
    const input = initialOwnerInput(
      {
        ...form,
        installationCode: "",
        consentConfirmed: false,
        embeddings: undefined,
      },
      { ...fresh, requiresFace: false, requiresInstallationCode: false },
      requestId
    );
    expect(input).not.toHaveProperty("embeddings");
    expect(input).not.toHaveProperty("installationCode");
  });
  it("rejects invalid PIN and strips installation secrets from errors", () => {
    expect(() =>
      initialOwnerInput(
        { ...form, pin: "abcd", pinConfirmation: "abcd" },
        fresh,
        requestId
      )
    ).toThrow("PIN");
    expect(
      initialSetupErrorMessage(
        new Error("รหัส example-install-code ไม่ถูกต้อง"),
        [form.installationCode]
      )
    ).toBe("รหัส [ซ่อนข้อมูล] ไม่ถูกต้อง");
    expect(
      initialSetupErrorMessage(new Error("Failed query SELECT pin FROM staff"))
    ).not.toContain("SELECT");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessTokenFromStoredSupabaseSession } from "./supabase";

const AUTH_KEY = "pumppos_supabase_auth";
const LEGACY_PROOF_KEY = "pumppos_face_proof";
const REMEMBERED_KEY = "pumppos_passkey_users_v2";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("accessTokenFromStoredSupabaseSession", () => {
  const nowMs = 1_800_000_000_000;
  const nowSeconds = Math.floor(nowMs / 1000);

  it("returns a valid persisted access token", () => {
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "signed-access-token",
          expires_at: nowSeconds + 3_600,
        }),
        nowMs
      )
    ).toBe("signed-access-token");
  });

  it("rejects expired, nearly expired, and malformed sessions", () => {
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "expired",
          expires_at: nowSeconds,
        }),
        nowMs
      )
    ).toBeNull();
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "nearly-expired",
          expires_at: nowSeconds + 20,
        }),
        nowMs
      )
    ).toBeNull();
    expect(accessTokenFromStoredSupabaseSession("not-json", nowMs)).toBeNull();
  });
});

describe("browser Supabase credential storage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the current tab session during reload when a passkey is remembered", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    localStorage.setItem(REMEMBERED_KEY, '["somchai"]');
    localStorage.setItem(AUTH_KEY, "old-auth");
    localStorage.setItem(LEGACY_PROOF_KEY, "old-proof");
    sessionStorage.setItem(AUTH_KEY, "session-auth");
    sessionStorage.setItem(LEGACY_PROOF_KEY, "session-proof");
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const supabase = await import("./supabase");

    expect(localStorage.getItem(REMEMBERED_KEY)).toBe('["somchai"]');
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBe("session-auth");
    expect(sessionStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(supabase.hasRememberedPasskey()).toBe(true);
    expect(supabase.hasRememberedPasskey("Somchai")).toBe(true);
    expect(supabase.hasRememberedPasskey("someone-else")).toBe(false);
    expect(supabase.hasPersistedSupabaseSession()).toBe(true);
  });

  it("clears legacy localStorage while retaining an unremembered browser session", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const accessToken = "current-session-token";
    const storedAuth = JSON.stringify({
      access_token: accessToken,
      expires_at: Math.floor(Date.now() / 1000) + 3_600,
    });
    localStorage.setItem(AUTH_KEY, "old-auth");
    localStorage.setItem(LEGACY_PROOF_KEY, "old-proof");
    sessionStorage.setItem(AUTH_KEY, storedAuth);
    sessionStorage.setItem(LEGACY_PROOF_KEY, "current-proof");
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const supabase = await import("./supabase");

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBe(storedAuth);
    expect(sessionStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(supabase.hasRememberedPasskey()).toBe(false);
    expect(supabase.hasPersistedSupabaseSession()).toBe(true);
    expect(await supabase.currentSupabaseAccessToken()).toBe(accessToken);

    await supabase.clearSupabaseSession();
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
  });

  it("retains the desktop session in localStorage for the offline runtime", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const accessToken = "desktop-session-token";
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        access_token: accessToken,
        expires_at: Math.floor(Date.now() / 1000) + 3_600,
      })
    );
    localStorage.setItem(LEGACY_PROOF_KEY, "desktop-proof");
    vi.stubGlobal("window", { posDesktop: {}, localStorage, sessionStorage });

    const supabase = await import("./supabase");

    expect(supabase.hasPersistedSupabaseSession()).toBe(true);
    expect(localStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(await supabase.currentSupabaseAccessToken()).toBe(accessToken);
  });

  it("stores the passkey marker locally without creating an auth session", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const supabase = await import("./supabase");
    supabase.rememberPasskey("Somchai");

    expect(localStorage.getItem(REMEMBERED_KEY)).toBe('["somchai"]');
    expect(localStorage.getItem(LEGACY_PROOF_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("ignores markers from the earlier Supabase passkey flow", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    localStorage.setItem("pumppos_passkey_users_v1", '["somchai"]');
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const supabase = await import("./supabase");

    expect(supabase.hasRememberedPasskey()).toBe(false);
  });
});

describe("installSupabaseSession", () => {
  const setSession = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    setSession.mockReset();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
    });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { setSession } }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("installs a normal Auth session using its access and refresh tokens", async () => {
    setSession.mockResolvedValue({ error: null });
    const supabase = await import("./supabase");

    expect(
      await supabase.installSupabaseSession({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      })
    ).toBe(true);
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("clears stale Auth credentials when session installation fails", async () => {
    setSession.mockResolvedValue({ error: new Error("Invalid session") });
    const supabase = await import("./supabase");
    window.sessionStorage.setItem(AUTH_KEY, "stale-session");

    expect(
      await supabase.installSupabaseSession({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      })
    ).toBe(false);
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});

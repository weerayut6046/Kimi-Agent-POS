import type { SupabaseClient } from "@supabase/supabase-js";
import { staffAuthEmail } from "@contracts/auth";

export type SupabaseRealtimeSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const SUPABASE_AUTH_STORAGE_KEY = "pumppos_supabase_auth";
const ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS = 30;

let browserClient: Promise<SupabaseClient | null> | undefined;

type StoredSupabaseSession = {
  access_token?: unknown;
  expires_at?: unknown;
};

export function accessTokenFromStoredSupabaseSession(
  raw: string | null,
  nowMs = Date.now()
): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSupabaseSession;
    if (
      typeof parsed.access_token !== "string" ||
      parsed.access_token.length === 0 ||
      typeof parsed.expires_at !== "number" ||
      parsed.expires_at <=
        Math.floor(nowMs / 1000) + ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS
    ) {
      return null;
    }
    return parsed.access_token;
  } catch {
    return null;
  }
}

function persistedSupabaseAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return accessTokenFromStoredSupabaseSession(
      window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function hasPersistedSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function getSupabaseBrowserClient(): Promise<SupabaseClient | null> {
  if (browserClient !== undefined) return browserClient;
  if (!supabaseUrl || !supabasePublishableKey) {
    browserClient = Promise.resolve(null);
    return browserClient;
  }

  browserClient = import("@supabase/supabase-js").then(({ createClient }) => {
    return createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
    });
  });
  return browserClient;
}

export async function installSupabaseSession(
  session: SupabaseRealtimeSession | null | undefined
): Promise<boolean> {
  const client = await getSupabaseBrowserClient();
  if (!client || !session) return false;
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  return !error;
}

export async function clearSupabaseSession(): Promise<void> {
  const client = await getSupabaseBrowserClient();
  if (!client) return;
  await client.auth.signOut({ scope: "local" });
}

export async function signInStaffWithPassword(
  username: string,
  password: string
): Promise<void> {
  const client = await getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase Auth is not configured");
  const { error } = await client.auth.signInWithPassword({
    email: staffAuthEmail(username),
    password,
  });
  if (error) throw new Error(error.message);
}

export async function currentSupabaseAccessToken(): Promise<string | null> {
  // Supabase persists the current session as JSON. Reading a still-valid
  // access token directly lets the first authenticated request start without
  // downloading and initializing the full Auth SDK. Expired sessions still
  // fall through to the SDK so its normal refresh flow remains intact.
  const persistedToken = persistedSupabaseAccessToken();
  if (persistedToken) return persistedToken;

  const client = await getSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

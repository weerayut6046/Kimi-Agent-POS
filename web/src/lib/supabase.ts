import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseRealtimeSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  faceProof: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const SUPABASE_AUTH_STORAGE_KEY = "pumppos_supabase_auth";
const FACE_PROOF_STORAGE_KEY = "pumppos_face_proof";
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

  window.localStorage.setItem(FACE_PROOF_STORAGE_KEY, session.faceProof);
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) window.localStorage.removeItem(FACE_PROOF_STORAGE_KEY);
  return !error;
}

export function currentFaceSessionProof(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(FACE_PROOF_STORAGE_KEY);
}

export async function clearSupabaseSession(): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(FACE_PROOF_STORAGE_KEY);
  }
  const client = await getSupabaseBrowserClient();
  if (!client) return;
  await client.auth.signOut({ scope: "local" });
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

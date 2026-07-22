import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseRealtimeSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

let browserClient: Promise<SupabaseClient | null> | undefined;

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
        storageKey: "pumppos_supabase_auth",
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

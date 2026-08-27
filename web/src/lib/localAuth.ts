const LOCAL_SESSION_STORAGE_KEY = "pumppos_local_auth_session";

export const isLocalAuthEnabled =
  import.meta.env.VITE_LOCAL_AUTH_ENABLED?.trim().toLowerCase() === "true";

export function readLocalSessionToken(): string | null {
  if (!isLocalAuthEnabled || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function hasPersistedLocalSession(): boolean {
  return Boolean(readLocalSessionToken());
}

export function installLocalSession(token: string): void {
  if (!isLocalAuthEnabled || typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, token);
}

export function clearLocalSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
}

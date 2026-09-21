const FACE_LOGIN_PENDING_KEY = "pumppos_face_login_pending_v1";

export function markFaceLoginPending(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FACE_LOGIN_PENDING_KEY, "1");
}

export function clearFaceLoginPending(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FACE_LOGIN_PENDING_KEY);
}

export function hasPendingFaceLogin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FACE_LOGIN_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

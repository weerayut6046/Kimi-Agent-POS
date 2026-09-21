const TOKEN_PREFIX = "PUMPATT1.";

export function attendanceTokenFromPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.startsWith(TOKEN_PREFIX) && trimmed.length <= 2_048) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.pathname.replace(/\/+$/, "") !== "/attendance") return null;
    const token = url.searchParams.get("token")?.trim() ?? "";
    return token.startsWith(TOKEN_PREFIX) && token.length <= 2_048
      ? token
      : null;
  } catch {
    return null;
  }
}

export function attendanceQrUrl(origin: string, token: string): string {
  const url = new URL("/attendance", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

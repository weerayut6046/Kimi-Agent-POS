/** Accept app origins only: metadata must never become a secret-bearing URL. */
export function normalizeBusinessAppUrl(
  value: string,
  allowLocalhost: boolean
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("กรุณาระบุ URL ของแอปให้ถูกต้อง");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "URL ต้องเป็นที่อยู่หลักของแอป โดยไม่มีรหัสผ่าน path หรือ query"
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (local && !allowLocalhost) {
    throw new Error("Production ไม่รองรับ URL localhost");
  }
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("URL ของแอปต้องใช้ HTTPS (localhost ใช้ HTTP ได้ขณะพัฒนา)");
  }
  if (!url.hostname || (!local && !url.hostname.includes("."))) {
    throw new Error("กรุณาระบุโดเมนของแอปให้ถูกต้อง");
  }
  return url.origin;
}

export function isRegistryUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return (
    candidate.code === "23505" ||
    (candidate.cause !== error && isRegistryUniqueViolation(candidate.cause))
  );
}

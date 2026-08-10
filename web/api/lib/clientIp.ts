const MAX_IP_LENGTH = 45; // เผื่อ IPv6 เต็มรูปแบบ

/**
 * อ่าน IP ผู้เรียกจาก header proxy — ใช้ entry แรกของ x-forwarded-for
 * ก่อน แล้วค่อย fallback เป็น x-real-ip; ไม่มีให้คืน ""
 */
export function clientIpFromReq(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return (forwarded || real || "").slice(0, MAX_IP_LENGTH);
}

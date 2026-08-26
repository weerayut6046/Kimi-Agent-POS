export const MEMBER_CARD_VALIDITY_YEARS = 1;

export function isMemberCardExpired(
  expiresAt: Date | string,
  now: Date | number = Date.now()
) {
  const expiryMs = new Date(expiresAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(expiryMs) && expiryMs <= nowMs;
}

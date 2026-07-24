const STAFF_AUTH_DOMAIN = "staff.pumppos.invalid";

/**
 * Staff usernames are also used as deterministic Supabase Auth identities.
 * Keeping the mapping client/server identical lets the browser authenticate
 * directly with Supabase without exposing a username lookup endpoint.
 */
export function normalizeStaffUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidStaffUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(
    normalizeStaffUsername(username),
  );
}

export function staffAuthEmail(username: string): string {
  const normalized = normalizeStaffUsername(username);
  if (!isValidStaffUsername(normalized)) {
    throw new Error(
      "Username must use 3-64 English letters, numbers, dots, dashes, or underscores",
    );
  }
  return `${normalized}@${STAFF_AUTH_DOMAIN}`;
}

import { eq } from "drizzle-orm";
import { staffUsers } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  staffSessionFromHeader,
  type StaffSessionClaims,
} from "./session";

const ACTIVE_STAFF_CACHE_MS = 5_000;
const activeStaffCache = new Map<
  number,
  { role: StaffSessionClaims["role"]; username: string; validUntil: number }
>();

/**
 * Validate both the HMAC signature and the current database account state.
 * The short cache avoids adding a remote database round-trip to every query
 * while keeping staff deactivation/role changes close to immediate.
 */
export async function activeStaffSessionFromRequest(
  request: Request
): Promise<StaffSessionClaims | null> {
  const session = staffSessionFromHeader(request);
  if (!session) return null;

  const cached = activeStaffCache.get(session.id);
  if (
    cached &&
    cached.validUntil > Date.now() &&
    cached.role === session.role &&
    cached.username === session.username
  ) {
    return session;
  }

  const staff = await getDb().query.staffUsers.findFirst({
    columns: { active: true, role: true, username: true },
    where: eq(staffUsers.id, session.id),
  });
  if (
    !staff?.active ||
    staff.role !== session.role ||
    staff.username !== session.username
  ) {
    activeStaffCache.delete(session.id);
    return null;
  }

  activeStaffCache.set(session.id, {
    role: staff.role,
    username: staff.username,
    validUntil: Date.now() + ACTIVE_STAFF_CACHE_MS,
  });
  return session;
}

export function clearActiveStaffCache(): void {
  activeStaffCache.clear();
}

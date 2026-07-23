import { eq } from "drizzle-orm";
import { staffUsers } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  staffSessionFromHeader,
  type StaffSessionClaims,
} from "./session";
import { branchForStaff } from "./branches";

const ACTIVE_STAFF_CACHE_MS = 5_000;
const activeStaffCache = new Map<
  string,
  {
    role: StaffSessionClaims["role"];
    username: string;
    branchCode: string;
    branchName: string;
    validUntil: number;
  }
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

  const cacheKey = `${session.id}:${session.branchId}`;
  const cached = activeStaffCache.get(cacheKey);
  if (
    cached &&
    cached.validUntil > Date.now() &&
    cached.role === session.role &&
    cached.username === session.username
  ) {
    return {
      ...session,
      branchCode: cached.branchCode,
      branchName: cached.branchName,
    };
  }

  const staff = await getDb().query.staffUsers.findFirst({
    columns: { id: true, active: true, role: true, username: true },
    where: eq(staffUsers.id, session.id),
  });
  if (
    !staff?.active ||
    staff.role !== session.role ||
    staff.username !== session.username
  ) {
    activeStaffCache.delete(cacheKey);
    return null;
  }

  const branch = await branchForStaff(staff, session.branchId);
  if (!branch) {
    activeStaffCache.delete(cacheKey);
    return null;
  }

  const activeSession = {
    ...session,
    branchCode: branch.code,
    branchName: branch.name,
  };
  activeStaffCache.set(cacheKey, {
    role: staff.role,
    username: staff.username,
    branchCode: branch.code,
    branchName: branch.name,
    validUntil: Date.now() + ACTIVE_STAFF_CACHE_MS,
  });
  return activeSession;
}

export function clearActiveStaffCache(): void {
  activeStaffCache.clear();
}

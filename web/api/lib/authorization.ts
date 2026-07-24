import { eq } from "drizzle-orm";
import { createClient, type JWK } from "@supabase/supabase-js";
import { staffUsers } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  bindStaffSessionToRequest,
  boundStaffSessionFromRequest,
  staffSessionFromHeader,
  type StaffSessionClaims,
} from "./session";
import { branchForStaff, defaultBranchForStaff } from "./branches";
import { env } from "./env";

const ACTIVE_STAFF_CACHE_MS = 5_000;
const activeStaffCache = new Map<
  string,
  Omit<StaffSessionClaims, "exp"> & { validUntil: number }
>();
const requestSessionPromises = new WeakMap<
  Request,
  Promise<StaffSessionClaims | null>
>();

const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

let authClient: ReturnType<typeof createClient> | undefined;
const configuredJwks = (() => {
  if (!env.supabaseJwks) return undefined;
  try {
    const parsed = JSON.parse(env.supabaseJwks) as { keys?: unknown };
    if (!Array.isArray(parsed.keys)) return undefined;
    return { keys: parsed.keys as JWK[] };
  } catch {
    return undefined;
  }
})();

function getAuthClient() {
  authClient ??= createClient(
    env.supabaseUrl,
    env.supabasePublishableKey,
    authOptions,
  );
  return authClient;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function requestedBranchId(request: Request): number | null {
  const raw = request.headers.get("x-branch-id")?.trim();
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function supabaseAuthUserId(request: Request): Promise<{
  id: string;
  exp: number;
} | null> {
  const token = bearerToken(request);
  if (!token || !env.supabaseUrl || !env.supabasePublishableKey) return null;
  const { data, error } = await getAuthClient().auth.getClaims(
    token,
    configuredJwks ? { jwks: configuredJwks } : {},
  );
  if (
    error ||
    !data?.claims ||
    typeof data.claims.sub !== "string" ||
    typeof data.claims.exp !== "number"
  ) {
    return null;
  }
  return { id: data.claims.sub, exp: data.claims.exp };
}

/**
 * Resolve the signed identity and current database account state once. The
 * short cache keeps deactivation/role changes close to immediate while
 * avoiding repeated staff/branch reads inside a warm Edge isolate.
 */
async function resolveActiveStaffSession(
  request: Request
): Promise<StaffSessionClaims | null> {
  const legacySession = staffSessionFromHeader(request);
  if (legacySession) {
    const legacyStaff = await getDb().query.staffUsers.findFirst({
      where: eq(staffUsers.id, legacySession.id),
    });
    if (
      !legacyStaff?.active ||
      legacyStaff.role !== legacySession.role ||
      legacyStaff.username !== legacySession.username
    ) {
      return null;
    }
    const legacyBranch = await branchForStaff(
      legacyStaff,
      legacySession.branchId,
    );
    if (!legacyBranch) return null;
    const activeLegacySession = {
      ...legacySession,
      branchCode: legacyBranch.code,
      branchName: legacyBranch.name,
    };
    bindStaffSessionToRequest(request, activeLegacySession);
    return activeLegacySession;
  }

  const identity = await supabaseAuthUserId(request);
  if (!identity) return null;

  const requestedBranch = requestedBranchId(request);
  const cacheKey = `${identity.id}:${requestedBranch ?? "default"}`;
  const cached = activeStaffCache.get(cacheKey);
  if (cached && cached.validUntil > Date.now()) {
    const { validUntil: _validUntil, ...cachedStaff } = cached;
    const activeSession = { ...cachedStaff, exp: identity.exp };
    bindStaffSessionToRequest(request, activeSession);
    return activeSession;
  }

  const staff = await getDb().query.staffUsers.findFirst({
    where: eq(staffUsers.supabaseAuthUserId, identity.id),
  });
  if (!staff?.active) return null;

  const branch = requestedBranch
    ? await branchForStaff(staff, requestedBranch)
    : await defaultBranchForStaff(staff);
  if (!branch) return null;

  const session: StaffSessionClaims = {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    username: staff.username,
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    exp: identity.exp,
  };
  const { exp: _exp, ...cacheableSession } = session;
  if (activeStaffCache.size >= 500) activeStaffCache.clear();
  activeStaffCache.set(cacheKey, {
    ...cacheableSession,
    validUntil: Date.now() + ACTIVE_STAFF_CACHE_MS,
  });
  bindStaffSessionToRequest(request, session);
  return session;
}

/**
 * Validate a request only once even when a tRPC HTTP batch executes several
 * procedures concurrently. Bound sessions are scoped to the Request object
 * and never become a browser-issued secondary credential.
 */
export async function activeStaffSessionFromRequest(
  request: Request
): Promise<StaffSessionClaims | null> {
  const bound = boundStaffSessionFromRequest(request);
  if (bound) return bound;

  const pending = requestSessionPromises.get(request);
  if (pending) return pending;

  const resolution = resolveActiveStaffSession(request);
  requestSessionPromises.set(request, resolution);
  try {
    return await resolution;
  } finally {
    if (requestSessionPromises.get(request) === resolution) {
      requestSessionPromises.delete(request);
    }
  }
}

export function clearActiveStaffCache(): void {
  activeStaffCache.clear();
}

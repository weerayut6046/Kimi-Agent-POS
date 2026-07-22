import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { staffUsers } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

export type SupabaseStaffSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type StaffAuthRecord = {
  id: number;
  supabaseAuthUserId: string | null;
};

type AuthIdentity = {
  id: string;
  email: string | null;
};

export type StaffAuthBridgeAdapter = {
  getUserById: (userId: string) => Promise<AuthIdentity | null>;
  findUserByEmail: (email: string) => Promise<AuthIdentity | null>;
  createUser: (email: string, password: string) => Promise<AuthIdentity | null>;
  updatePassword: (userId: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<SupabaseStaffSession>;
  linkStaff: (staffId: number, userId: string) => Promise<void>;
};

type StaffAuthBridgeFailureCode =
  | "admin_lookup_failed"
  | "create_failed"
  | "identity_mismatch"
  | "link_failed"
  | "password_update_failed"
  | "signin_failed"
  | "unknown";

class StaffAuthBridgeError extends Error {
  readonly code: StaffAuthBridgeFailureCode;

  constructor(code: StaffAuthBridgeFailureCode) {
    super(code);
    this.code = code;
  }
}

const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

function internalEmail(staffId: number): string {
  return `staff-${env.supabaseProjectRef}-${staffId}@auth.pumppos.invalid`;
}

function strongTemporaryPassword(): string {
  return `Aa1!${randomBytes(32).toString("hex")}`;
}

function authErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function defaultAdapter(): StaffAuthBridgeAdapter | null {
  if (
    !env.supabaseUrl ||
    !env.supabaseProjectRef ||
    !env.supabasePublishableKey ||
    !env.supabaseSecretKey
  ) {
    return null;
  }

  const adminClient = createClient(
    env.supabaseUrl,
    env.supabaseSecretKey,
    authOptions
  );
  const publicClient = createClient(
    env.supabaseUrl,
    env.supabasePublishableKey,
    authOptions
  );

  const findUserByEmail = async (
    email: string
  ): Promise<AuthIdentity | null> => {
    const pageSize = 200;
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage: pageSize,
      });
      if (error) throw new StaffAuthBridgeError("admin_lookup_failed");
      const match = data.users.find(
        user => user.email?.toLowerCase() === email.toLowerCase()
      );
      if (match) return { id: match.id, email: match.email ?? null };
      if (data.users.length < pageSize) return null;
    }
    throw new StaffAuthBridgeError("admin_lookup_failed");
  };

  return {
    async getUserById(userId) {
      const { data, error } = await adminClient.auth.admin.getUserById(userId);
      if (error) {
        if (authErrorCode(error) === "user_not_found") return null;
        throw new StaffAuthBridgeError("admin_lookup_failed");
      }
      return data.user
        ? { id: data.user.id, email: data.user.email ?? null }
        : null;
    },
    findUserByEmail,
    async createUser(email, password) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        // A concurrent request may have created the deterministic identity.
        return findUserByEmail(email);
      }
      return data.user
        ? { id: data.user.id, email: data.user.email ?? null }
        : null;
    },
    async updatePassword(userId, password) {
      const { error } = await adminClient.auth.admin.updateUserById(userId, {
        password,
      });
      if (error) throw new StaffAuthBridgeError("password_update_failed");
    },
    async signIn(email, password) {
      const { data, error } = await publicClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session) {
        throw new StaffAuthBridgeError("signin_failed");
      }
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt:
          data.session.expires_at ??
          Math.floor(Date.now() / 1000) + data.session.expires_in,
      };
    },
    async linkStaff(staffId, userId) {
      try {
        await getDb()
          .update(staffUsers)
          .set({ supabaseAuthUserId: userId })
          .where(eq(staffUsers.id, staffId));
      } catch {
        throw new StaffAuthBridgeError("link_failed");
      }
    },
  };
}

export async function issueSupabaseStaffSessionWithAdapter(
  staff: StaffAuthRecord,
  adapter: StaffAuthBridgeAdapter,
  passwordFactory: () => string = strongTemporaryPassword
): Promise<SupabaseStaffSession> {
  const expectedEmail = internalEmail(staff.id);
  let identity = staff.supabaseAuthUserId
    ? await adapter.getUserById(staff.supabaseAuthUserId)
    : null;

  if (
    identity &&
    identity.email?.toLowerCase() !== expectedEmail.toLowerCase()
  ) {
    throw new StaffAuthBridgeError("identity_mismatch");
  }

  identity ??= await adapter.findUserByEmail(expectedEmail);
  if (!identity) {
    identity = await adapter.createUser(expectedEmail, passwordFactory());
  }
  if (
    !identity ||
    identity.email?.toLowerCase() !== expectedEmail.toLowerCase()
  ) {
    throw new StaffAuthBridgeError("create_failed");
  }

  if (identity.id !== staff.supabaseAuthUserId) {
    await adapter.linkStaff(staff.id, identity.id);
  }

  // Rotate the internal password whenever a Realtime session is issued. It is
  // never returned to the browser and cannot be used as a staff login secret.
  let password = passwordFactory();
  await adapter.updatePassword(identity.id, password);
  try {
    return await adapter.signIn(expectedEmail, password);
  } catch {
    // A concurrent login may have rotated the password between update/sign-in.
    password = passwordFactory();
    await adapter.updatePassword(identity.id, password);
    return adapter.signIn(expectedEmail, password);
  }
}

export async function issueSupabaseStaffSession(
  staff: StaffAuthRecord
): Promise<SupabaseStaffSession | null> {
  const adapter = defaultAdapter();
  if (!adapter) return null;
  return issueSupabaseStaffSessionWithAdapter(staff, adapter);
}

export function staffAuthBridgeFailureCode(error: unknown): string {
  return error instanceof StaffAuthBridgeError ? error.code : "unknown";
}

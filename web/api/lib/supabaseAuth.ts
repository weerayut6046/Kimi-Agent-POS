import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { issueFaceSessionProof } from "./faceSessionProof";
import { env } from "./env";
import { staffAuthEmail } from "@contracts/auth";

const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

function authErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function requireAdminClient() {
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw new Error("Supabase Auth admin client is not configured");
  }
  return createClient(env.supabaseUrl, env.supabaseSecretKey, authOptions);
}

function requireUserClient() {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error("Supabase Auth user client is not configured");
  }
  return createClient(env.supabaseUrl, env.supabasePublishableKey, authOptions);
}

export type ProvisionedStaffIdentity = {
  id: string;
  email: string;
};

export type IssuedSupabaseStaffSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  faceProof: string;
};

/**
 * Create the canonical Supabase Auth identity for a staff account. New PIN +
 * face accounts are passwordless; the optional password exists only for
 * controlled migration/recovery and is never written to the POS database.
 */
export async function createSupabaseStaffIdentity(input: {
  username: string;
  password?: string;
  name: string;
  role: "admin" | "manager" | "cashier";
}): Promise<ProvisionedStaffIdentity> {
  const email = staffAuthEmail(input.username);
  const admin = requireAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    ...(input.password ? { password: input.password } : {}),
    email_confirm: true,
    app_metadata: {
      pos_staff: true,
      pos_role: input.role,
    },
    user_metadata: {
      display_name: input.name,
    },
  });
  if (error || !data.user) {
    throw new Error(error?.message || "Unable to create Supabase Auth user");
  }
  return { id: data.user.id, email };
}

/**
 * Mint a normal Supabase user session only after the POS has independently
 * verified both the employee PIN and face. generateLink does not send email;
 * its one-time token is immediately exchanged on the server and never exposed
 * to the browser.
 */
export async function issueSupabaseStaffSession(
  username: string,
  expectedUserId: string
): Promise<IssuedSupabaseStaffSession> {
  const email = staffAuthEmail(username);
  const admin = requireAdminClient();
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) {
    throw new Error(
      generated.error?.message || "Unable to create staff sign-in token"
    );
  }
  const verified = await requireUserClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  const session = verified.data.session;
  if (verified.error || !session || verified.data.user?.id !== expectedUserId) {
    throw new Error(
      verified.error?.message || "Unable to create staff sign-in session"
    );
  }
  const jwtPayload = JSON.parse(
    Buffer.from(session.access_token.split(".")[1] ?? "", "base64url")
      .toString("utf8")
  ) as { session_id?: unknown };
  if (typeof jwtPayload.session_id !== "string") {
    throw new Error("Supabase session is missing session_id");
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt:
      session.expires_at ?? Math.floor(Date.now() / 1_000) + session.expires_in,
    faceProof: issueFaceSessionProof(expectedUserId, jwtPayload.session_id),
  };
}

export async function updateSupabaseStaffIdentity(
  userId: string,
  input: {
    username?: string;
    password?: string;
    name?: string;
    role?: "admin" | "manager" | "cashier";
    active?: boolean;
  }
): Promise<void> {
  const admin = requireAdminClient();
  const attributes: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
    ban_duration?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  } = {};
  if (input.username !== undefined) {
    attributes.email = staffAuthEmail(input.username);
    attributes.email_confirm = true;
  }
  if (input.password !== undefined) attributes.password = input.password;
  if (input.active !== undefined) {
    attributes.ban_duration = input.active ? "none" : "876000h";
  }
  if (input.role !== undefined) {
    attributes.app_metadata = {
      pos_staff: true,
      pos_role: input.role,
    };
  }
  if (input.name !== undefined) {
    attributes.user_metadata = { display_name: input.name };
  }
  const { error } = await admin.auth.admin.updateUserById(userId, attributes);
  if (error) throw new Error(error.message);
}

export async function deleteSupabaseStaffIdentity(
  userId: string
): Promise<void> {
  const admin = requireAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error && authErrorCode(error) !== "user_not_found") {
    throw new Error(error.message);
  }
}

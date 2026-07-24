import { createClient } from "@supabase/supabase-js";
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

export type ProvisionedStaffIdentity = {
  id: string;
  email: string;
};

/**
 * Create the canonical Supabase Auth identity for a staff account. Passwords
 * are sent only to Supabase Auth and are never written to the POS database.
 */
export async function createSupabaseStaffIdentity(input: {
  username: string;
  password: string;
  name: string;
  role: "admin" | "manager" | "cashier";
}): Promise<ProvisionedStaffIdentity> {
  const email = staffAuthEmail(input.username);
  const admin = requireAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
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

export async function updateSupabaseStaffIdentity(
  userId: string,
  input: {
    username?: string;
    password?: string;
    name?: string;
    role?: "admin" | "manager" | "cashier";
    active?: boolean;
  },
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
  userId: string,
): Promise<void> {
  const admin = requireAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error && authErrorCode(error) !== "user_not_found") {
    throw new Error(error.message);
  }
}

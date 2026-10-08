import { z } from "zod";
import { isValidStaffUsername, normalizeStaffUsername } from "./auth";

export const INITIAL_INSTALLATION_KEY = "business_installation_v1";

export type InitialSetupCheck = {
  key: "database" | "schema" | "session" | "staff_auth" | "installation_code";
  status: "ready" | "missing" | "unavailable";
};

/** Minimal installation state: no business, account, or token data. */
export type InitialSetupState = {
  needsOwner: boolean;
  canCreateOwner: boolean;
  requiresInstallationCode: boolean;
  /** Server-generated readiness only; never includes connection strings or keys. */
  systemReady?: boolean;
  databaseMode?: "supabase" | "local";
  checks?: InitialSetupCheck[];
};

export const createInitialOwnerInput = z
  .object({
    requestId: z.uuid(),
    installationCode: z.string().max(256).optional(),
    name: z.string().trim().min(1, "กรุณาระบุชื่อเจ้าของกิจการ").max(120),
    username: z
      .string()
      .transform(normalizeStaffUsername)
      .refine(
        isValidStaffUsername,
        "ชื่อผู้ใช้ต้องมี 3–64 ตัว ใช้อักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง"
      ),
    pin: z.string().regex(/^\d{4,6}$/, "PIN ต้องเป็นตัวเลข 4–6 หลัก"),
  })
  .strict();
export type CreateInitialOwnerInput = z.infer<typeof createInitialOwnerInput>;

import { and, eq } from "drizzle-orm";
import { settings } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

const MANAGEMENT_API_TIMEOUT_MS = 8_000;
const RESTORE_DRILL_SETTING_KEY = "backup_restore_drill_v1";
const DAILY_BACKUP_WARNING_AGE_MS = 36 * 60 * 60 * 1_000;
const RESTORE_DRILL_CHECK_KEYS = [
  "login",
  "dashboard",
  "shifts",
  "sales",
  "stock",
  "credit",
  "audit",
] as const;

export type ManagedBackupHealthStatus =
  "healthy" | "warning" | "error" | "unverified";

export type ManagedBackupHealth = {
  status: ManagedBackupHealthStatus;
  managementApiConfigured: boolean;
  checkedAt: Date;
  message: string;
  region: string | null;
  pitrEnabled: boolean | null;
  latestBackupAt: Date | null;
  latestBackupStatus: string | null;
  earliestRestoreAt: Date | null;
  latestRestoreAt: Date | null;
};

export type RestoreDrillChecks = {
  login: boolean;
  dashboard: boolean;
  shifts: boolean;
  sales: boolean;
  stock: boolean;
  credit: boolean;
  audit: boolean;
};

export type RestoreDrillRecord = {
  version: 1;
  performedAt: string;
  result: "passed" | "failed";
  rpoMinutes: number;
  rtoMinutes: number;
  targetProject: string;
  backupReference: string;
  notes: string;
  checks: RestoreDrillChecks;
  actorId: number;
  actorName: string;
  recordedAt: string;
};

type BackupApiItem = {
  status?: unknown;
  inserted_at?: unknown;
};

type BackupApiResponse = {
  region?: unknown;
  pitr_enabled?: unknown;
  backups?: unknown;
  physical_backup_data?: {
    earliest_physical_backup_date_unix?: unknown;
    latest_physical_backup_date_unix?: unknown;
  } | null;
};

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function unixDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * 1_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function presentManagedBackupHealth(
  payload: BackupApiResponse,
  now = new Date()
): ManagedBackupHealth {
  const backups = Array.isArray(payload.backups)
    ? (payload.backups as BackupApiItem[])
        .map(item => ({
          status:
            typeof item?.status === "string"
              ? item.status.toUpperCase()
              : "UNKNOWN",
          insertedAt: validDate(item?.inserted_at),
        }))
        .filter(
          (item): item is { status: string; insertedAt: Date } =>
            item.insertedAt !== null
        )
        .sort(
          (left, right) =>
            right.insertedAt.getTime() - left.insertedAt.getTime()
        )
    : [];
  const latest = backups[0] ?? null;
  const pitrEnabled =
    typeof payload.pitr_enabled === "boolean" ? payload.pitr_enabled : null;
  const earliestRestoreAt = unixDate(
    payload.physical_backup_data?.earliest_physical_backup_date_unix
  );
  const latestRestoreAt = unixDate(
    payload.physical_backup_data?.latest_physical_backup_date_unix
  );

  let status: ManagedBackupHealthStatus = "warning";
  let message = "ยังไม่พบข้อมูล Backup ที่ตรวจสอบได้";
  if (latest && latest.status !== "COMPLETED") {
    status = "warning";
    message = `Backup ล่าสุดมีสถานะ ${latest.status}`;
  } else if (pitrEnabled && earliestRestoreAt && latestRestoreAt) {
    status = "healthy";
    message = "PITR พร้อมใช้งานและมีช่วงเวลากู้คืนที่ตรวจสอบได้";
  } else if (latest) {
    const completed = latest.status === "COMPLETED";
    const fresh =
      now.getTime() - latest.insertedAt.getTime() <=
      DAILY_BACKUP_WARNING_AGE_MS;
    status = completed && fresh ? "healthy" : "warning";
    message = completed
      ? fresh
        ? "Managed Backup ล่าสุดเสร็จสมบูรณ์"
        : "Backup ล่าสุดเกิน 36 ชั่วโมง กรุณาตรวจใน Supabase Dashboard"
      : `Backup ล่าสุดมีสถานะ ${latest.status}`;
  }

  return {
    status,
    managementApiConfigured: true,
    checkedAt: now,
    message,
    region: typeof payload.region === "string" ? payload.region : null,
    pitrEnabled,
    latestBackupAt: latest?.insertedAt ?? null,
    latestBackupStatus: latest?.status ?? null,
    earliestRestoreAt,
    latestRestoreAt,
  };
}

function unverifiedHealth(message: string): ManagedBackupHealth {
  return {
    status: "unverified",
    managementApiConfigured: false,
    checkedAt: new Date(),
    message,
    region: null,
    pitrEnabled: null,
    latestBackupAt: null,
    latestBackupStatus: null,
    earliestRestoreAt: null,
    latestRestoreAt: null,
  };
}

export async function loadManagedBackupHealth(): Promise<ManagedBackupHealth> {
  if (!env.supabaseProjectRef) {
    return unverifiedHealth(
      "ไม่พบ Project Ref จาก SUPABASE_URL หากใช้ custom domain ให้ตั้ง PUMPPOS_PROJECT_REF"
    );
  }
  if (!env.supabaseManagementAccessToken) {
    return unverifiedHealth(
      "ยังไม่ได้เชื่อม Management API กรุณาตรวจสถานะล่าสุดใน Supabase Dashboard"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    MANAGEMENT_API_TIMEOUT_MS
  );
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${encodeURIComponent(env.supabaseProjectRef)}/database/backups`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${env.supabaseManagementAccessToken}`,
        },
        cache: "no-store",
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      return {
        ...unverifiedHealth(
          `ตรวจ Managed Backup ไม่สำเร็จ (HTTP ${response.status})`
        ),
        status: "error",
        managementApiConfigured: true,
      };
    }
    return presentManagedBackupHealth(
      (await response.json()) as BackupApiResponse
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      ...unverifiedHealth(
        timedOut
          ? "ตรวจ Managed Backup ไม่สำเร็จภายในเวลาที่กำหนด"
          : "เชื่อมต่อ Supabase Management API ไม่สำเร็จ"
      ),
      status: "error",
      managementApiConfigured: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isRestoreDrillRecord(value: unknown): value is RestoreDrillRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RestoreDrillRecord>;
  return (
    record.version === 1 &&
    typeof record.performedAt === "string" &&
    (record.result === "passed" || record.result === "failed") &&
    typeof record.rpoMinutes === "number" &&
    Number.isFinite(record.rpoMinutes) &&
    typeof record.rtoMinutes === "number" &&
    Number.isFinite(record.rtoMinutes) &&
    typeof record.targetProject === "string" &&
    typeof record.backupReference === "string" &&
    typeof record.notes === "string" &&
    typeof record.actorId === "number" &&
    typeof record.actorName === "string" &&
    typeof record.recordedAt === "string" &&
    Boolean(record.checks) &&
    RESTORE_DRILL_CHECK_KEYS.every(
      key => typeof record.checks?.[key] === "boolean"
    )
  );
}

export async function loadRestoreDrillRecord(
  branchId: number
): Promise<RestoreDrillRecord | null> {
  const row = await getDb().query.settings.findFirst({
    where: and(
      eq(settings.branchId, branchId),
      eq(settings.key, RESTORE_DRILL_SETTING_KEY)
    ),
    columns: { value: true },
  });
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return isRestoreDrillRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveRestoreDrillRecord(
  branchId: number,
  record: RestoreDrillRecord
): Promise<void> {
  await getDb()
    .insert(settings)
    .values({
      branchId,
      key: RESTORE_DRILL_SETTING_KEY,
      value: JSON.stringify(record),
    })
    .onConflictDoUpdate({
      target: [settings.branchId, settings.key],
      set: { value: JSON.stringify(record) },
    });
}

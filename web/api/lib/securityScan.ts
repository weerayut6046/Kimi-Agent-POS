import { and, eq, gte, lt } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import {
  auditLogs,
  loginAttempts,
  securityEvents,
  type AuditLog,
  type LoginAttempt,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";
import { loadManagedBackupHealth } from "./backupHealth";

// ---------- เกณฑ์ของกฎ (ปรับได้ที่เดียว) ----------
export const BRUTE_FORCE_FAILURE_THRESHOLD = 5;
export const BRUTE_FORCE_WINDOW_MS = 10 * 60_000;
export const BRUTE_FORCE_SUCCESS_WITHIN_MS = 30 * 60_000;
export const MASS_VOID_WARNING_THRESHOLD = 3;
export const MASS_VOID_CRITICAL_THRESHOLD = 10;
export const MASS_VOID_WINDOW_MS = 60 * 60_000;
export const OFF_HOURS_START = 22; // 22:00
export const OFF_HOURS_END = 5; // 05:00
export const PRICE_BURST_THRESHOLD = 10;
export const PRICE_BURST_WINDOW_MS = 60 * 60_000;
export const APP_SECRET_MIN_LENGTH = 16;
export const LOGIN_ATTEMPT_RETENTION_DAYS = 30;
export const NPM_AUDIT_TIMEOUT_MS = 20_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

const VOID_SALE_ACTIONS = ["void_sale", "delete_sale"];
const PERMISSION_GROUP_ACTIONS = [
  "create_staff_access_group",
  "update_staff_access_group",
  "delete_staff_access_group",
];
// ตรงกับข้อความสรุปการเปลี่ยนแปลงที่ auth.updateStaff เขียนลง audit detail
const PERMISSION_DETAIL_PATTERN = /role|สิทธิ์เมนู|กลุ่มสิทธิ์/;
const DEFAULTISH_SECRETS = [
  "secret",
  "changeme",
  "change-me",
  "default",
  "password",
  "app-secret",
  "your-secret",
  "dev-secret",
];
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type SecurityCategory =
  | "auth"
  | "data_tampering"
  | "permission"
  | "vulnerability"
  | "system";
type SecuritySeverity = "info" | "warning" | "critical";

type EventDraft = {
  category: SecurityCategory;
  severity: SecuritySeverity;
  rule: string;
  title: string;
  detail: Record<string, unknown>;
  actorId: number | null;
  actorName: string;
};

export type SecurityScanResult = {
  scanned: number;
  created: number;
  byRule: Record<string, number>;
};

export type NpmAuditSummary = {
  critical: number;
  high: number;
  moderate: number;
};
export type NpmAuditRunner = () => Promise<NpmAuditSummary | null>;

export type ConfigHygieneFinding = {
  check: string;
  title: string;
  detail: Record<string, unknown>;
};

/** ตรวจค่าคอนฟิก runtime ที่เสี่ยง — แยกเป็น pure function เพื่อทดสอบได้ */
export function configHygieneChecks(input: {
  appSecret: string;
  legacyHmacSessionEnabled: boolean;
  nodeEnv: string;
}): ConfigHygieneFinding[] {
  const findings: ConfigHygieneFinding[] = [];
  const secret = input.appSecret;
  if (
    secret.length < APP_SECRET_MIN_LENGTH ||
    DEFAULTISH_SECRETS.includes(secret.toLowerCase())
  ) {
    findings.push({
      check: "app_secret",
      title: "APP_SECRET สั้นเกินไปหรือใช้ค่าเริ่มต้น เสี่ยงถูกปลอมเซสชัน/ถอดรหัสข้อมูล",
      detail: { check: "app_secret", length: secret.length },
    });
  }
  // session.ts รับเซสชัน HMAC เดิมเฉพาะ NODE_ENV=test เท่านั้น — ถ้าหลุดไปอยู่
  // ในคอนฟิกจริงถือเป็นช่องโหว่ร้ายแรง
  if (input.legacyHmacSessionEnabled && input.nodeEnv !== "test") {
    findings.push({
      check: "legacy_hmac_session",
      title: "เซสชันพนักงานแบบ HMAC เดิมเปิดใช้งานนอกโหมดทดสอบ",
      detail: { check: "legacy_hmac_session", nodeEnv: input.nodeEnv },
    });
  }
  return findings;
}

const defaultNpmAuditRunner: NpmAuditRunner = async () => {
  try {
    const { execFile } = await import("node:child_process");
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["audit", "--omit=dev", "--json"],
        {
          cwd: REPO_ROOT,
          timeout: NPM_AUDIT_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, output) => {
          // npm audit exit code 1 เมื่อพบช่องโหว่ — stdout ยังใช้ได้
          if (output) resolve(output);
          else reject(error);
        }
      );
    });
    const parsed: unknown = JSON.parse(stdout);
    const vulnerabilities = (
      parsed as { metadata?: { vulnerabilities?: Record<string, unknown> } }
    )?.metadata?.vulnerabilities;
    return {
      critical: Number(vulnerabilities?.critical) || 0,
      high: Number(vulnerabilities?.high) || 0,
      moderate: Number(vulnerabilities?.moderate) || 0,
    };
  } catch {
    // ติดตั้ง npm ไม่ได้ / audit พัง / timeout — ข้ามกฎนี้เงียบๆ
    return null;
  }
};

function actorKey(actorId: number | null, actorName: string): string {
  return actorId != null ? `id:${actorId}` : `name:${actorName}`;
}

/** จำนวนรายการมากสุดภายใน sliding window (rows ต้องเรียงเวลาแล้ว) */
function maxInSlidingWindow(rows: { createdAt: Date }[], windowMs: number) {
  let best = 0;
  let bestEnd: Date | null = null;
  let left = 0;
  for (let right = 0; right < rows.length; right += 1) {
    while (
      rows[right].createdAt.getTime() - rows[left].createdAt.getTime() >
      windowMs
    ) {
      left += 1;
    }
    const count = right - left + 1;
    if (count > best) {
      best = count;
      bestEnd = rows[right].createdAt;
    }
  }
  return { count: best, end: bestEnd };
}

/** key สำหรับกันการสร้าง event ซ้ำ — เติมตัวแยกเฉพาะของแต่ละกฎ */
function dedupeKeyFor(event: {
  rule: string;
  actorId: number | null;
  actorName: string;
  detail: Record<string, unknown>;
}): string {
  const detail = event.detail;
  switch (event.rule) {
    case "brute_force_login":
    case "brute_force_login_success":
      return String(detail.username ?? "");
    case "mass_void":
    case "price_change_burst":
      return actorKey(event.actorId, event.actorName);
    case "off_hours_activity":
      return `${actorKey(event.actorId, event.actorName)}|${String(
        detail.night ?? ""
      )}`;
    case "permission_escalation":
      return String(detail.auditId ?? "");
    case "config_hygiene":
      return String(detail.check ?? "");
    default:
      return "";
  }
}

function byCreatedAt(left: { createdAt: Date }, right: { createdAt: Date }) {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function bangkokHour(date: Date): number {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCHours();
}

function bangkokNightKey(date: Date): string {
  const shifted = new Date(
    date.getTime() + BANGKOK_OFFSET_MS - OFF_HOURS_END * 3_600_000
  );
  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function bruteForceDrafts(loginRows: LoginAttempt[]): EventDraft[] {
  const drafts: EventDraft[] = [];
  const failuresByUsername = new Map<string, LoginAttempt[]>();
  for (const row of loginRows) {
    if (row.success) continue;
    const list = failuresByUsername.get(row.username) ?? [];
    list.push(row);
    failuresByUsername.set(row.username, list);
  }
  for (const [username, failures] of failuresByUsername) {
    failures.sort(byCreatedAt);
    const burst = maxInSlidingWindow(failures, BRUTE_FORCE_WINDOW_MS);
    if (burst.count < BRUTE_FORCE_FAILURE_THRESHOLD || !burst.end) continue;
    const ips = [...new Set(failures.map(row => row.ip).filter(Boolean))].slice(
      0,
      10
    );
    drafts.push({
      category: "auth",
      severity: "critical",
      rule: "brute_force_login",
      title: `พยายาม login ผิดพลาดซ้ำๆ (${username})`,
      detail: {
        username,
        failures: burst.count,
        ips,
        windowMinutes: BRUTE_FORCE_WINDOW_MS / 60_000,
      },
      actorId: null,
      actorName: username,
    });

    // สัญญาณที่น่ากลัวสุด: login สำเร็จไม่นานหลัง burst ผิดพลาด
    const succeededAfter = loginRows.some(
      row =>
        row.success &&
        row.username === username &&
        row.createdAt.getTime() > burst.end!.getTime() &&
        row.createdAt.getTime() - burst.end!.getTime() <=
          BRUTE_FORCE_SUCCESS_WITHIN_MS
    );
    if (succeededAfter) {
      drafts.push({
        category: "auth",
        severity: "critical",
        rule: "brute_force_login_success",
        title: "login สำเร็จหลังพยายามผิดพลาดหลายครั้ง",
        detail: {
          username,
          failures: burst.count,
          withinMinutes: BRUTE_FORCE_SUCCESS_WITHIN_MS / 60_000,
        },
        actorId: null,
        actorName: username,
      });
    }
  }
  return drafts;
}

function massVoidDrafts(auditRows: AuditLog[]): EventDraft[] {
  const groups = new Map<string, AuditLog[]>();
  for (const row of auditRows) {
    if (!VOID_SALE_ACTIONS.includes(row.action)) continue;
    const key = actorKey(row.actorId, row.actorName);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const drafts: EventDraft[] = [];
  for (const rows of groups.values()) {
    rows.sort(byCreatedAt);
    const burst = maxInSlidingWindow(rows, MASS_VOID_WINDOW_MS);
    if (burst.count < MASS_VOID_WARNING_THRESHOLD) continue;
    const first = rows[0];
    const critical = burst.count >= MASS_VOID_CRITICAL_THRESHOLD;
    drafts.push({
      category: "data_tampering",
      severity: critical ? "critical" : "warning",
      rule: "mass_void",
      title: `ยกเลิก/ลบบิลขาย ${burst.count} ครั้งภายใน 1 ชั่วโมง (${first.actorName || "ไม่ทราบผู้ทำ"})`,
      detail: {
        actorId: first.actorId,
        actorName: first.actorName,
        count: burst.count,
        refIds: rows
          .map(row => row.refId)
          .filter((id): id is number => id != null)
          .slice(0, 20),
      },
      actorId: first.actorId,
      actorName: first.actorName,
    });
  }
  return drafts;
}

function offHoursDrafts(auditRows: AuditLog[]): EventDraft[] {
  // คืนเดียวกัน = 22:00 ถึง 05:00 รุ่งเช้าใน Asia/Bangkok
  const groups = new Map<string, AuditLog[]>();
  for (const row of auditRows) {
    const hour = bangkokHour(row.createdAt);
    if (hour < OFF_HOURS_START && hour >= OFF_HOURS_END) continue;
    const key = `${actorKey(row.actorId, row.actorName)}|${bangkokNightKey(
      row.createdAt
    )}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const drafts: EventDraft[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const night = bangkokNightKey(first.createdAt);
    const actions: Record<string, number> = {};
    for (const row of rows) {
      actions[row.action] = (actions[row.action] ?? 0) + 1;
    }
    drafts.push({
      category: "data_tampering",
      severity: "warning",
      rule: "off_hours_activity",
      title: `มีรายการหลังเวลาทำการ 22:00–05:00 (${first.actorName || "ไม่ทราบผู้ทำ"})`,
      detail: {
        actorName: first.actorName,
        night,
        actions,
        count: rows.length,
      },
      actorId: first.actorId,
      actorName: first.actorName,
    });
  }
  return drafts;
}

function priceBurstDrafts(auditRows: AuditLog[]): EventDraft[] {
  const groups = new Map<string, AuditLog[]>();
  for (const row of auditRows) {
    if (row.action !== "update_price") continue;
    const key = actorKey(row.actorId, row.actorName);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const drafts: EventDraft[] = [];
  for (const rows of groups.values()) {
    rows.sort(byCreatedAt);
    const burst = maxInSlidingWindow(rows, PRICE_BURST_WINDOW_MS);
    if (burst.count < PRICE_BURST_THRESHOLD) continue;
    const first = rows[0];
    drafts.push({
      category: "data_tampering",
      severity: "info",
      rule: "price_change_burst",
      title: `เปลี่ยนราคาสินค้า ${burst.count} ครั้งภายใน 1 ชั่วโมง (${first.actorName || "ไม่ทราบผู้ทำ"})`,
      detail: {
        actorId: first.actorId,
        actorName: first.actorName,
        count: burst.count,
      },
      actorId: first.actorId,
      actorName: first.actorName,
    });
  }
  return drafts;
}

function permissionEscalationDrafts(auditRows: AuditLog[]): EventDraft[] {
  const drafts: EventDraft[] = [];
  for (const row of auditRows) {
    const isAccessGroupChange = PERMISSION_GROUP_ACTIONS.includes(row.action);
    const isStaffPermissionChange =
      row.action === "update_staff" && PERMISSION_DETAIL_PATTERN.test(row.detail);
    if (!isAccessGroupChange && !isStaffPermissionChange) continue;
    drafts.push({
      category: "permission",
      severity: "warning",
      rule: "permission_escalation",
      title: `เปลี่ยนแปลงสิทธิ์ผู้ใช้/กลุ่มสิทธิ์ (${row.action})`,
      detail: {
        auditId: row.id,
        action: row.action,
        actorName: row.actorName,
        summary: row.detail.slice(0, 300),
      },
      actorId: row.actorId,
      actorName: row.actorName,
    });
  }
  return drafts;
}

/**
 * สแกนหาเหตุการณ์ความปลอดภัยตามกฎในช่วง [now - windowDays, now] ของสาขา
 * — กัน event ซ้ำกับรายการ status=new ที่ยังเปิดอยู่ และลบ login_attempts
 * ที่เก่ากว่ากำหนดเก็บทุกครั้งหลังสแกน
 */
export async function runSecurityScan(input: {
  branchId: number;
  windowDays: number;
  npmAuditRunner?: NpmAuditRunner;
}): Promise<SecurityScanResult> {
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - input.windowDays * 24 * 3_600_000);

  const [loginRows, auditRows] = await Promise.all([
    db
      .select()
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.branchId, input.branchId),
          gte(loginAttempts.createdAt, since)
        )
      ),
    db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.branchId, input.branchId),
          gte(auditLogs.createdAt, since)
        )
      ),
  ]);

  const drafts: EventDraft[] = [
    ...bruteForceDrafts(loginRows),
    ...massVoidDrafts(auditRows),
    ...offHoursDrafts(auditRows),
    ...priceBurstDrafts(auditRows),
    ...permissionEscalationDrafts(auditRows),
  ];

  // config_hygiene — คอนฟิก runtime + สถานะ backup
  for (const finding of configHygieneChecks({
    appSecret: env.appSecret,
    legacyHmacSessionEnabled: process.env.NODE_ENV === "test",
    nodeEnv: process.env.NODE_ENV ?? "",
  })) {
    drafts.push({
      category: "system",
      severity: "warning",
      rule: "config_hygiene",
      title: finding.title,
      detail: finding.detail,
      actorId: null,
      actorName: "",
    });
  }
  try {
    const backupHealth = await loadManagedBackupHealth();
    if (backupHealth.status === "warning" || backupHealth.status === "error") {
      drafts.push({
        category: "system",
        severity: "warning",
        rule: "config_hygiene",
        title: "สำรองข้อมูลล่าสุดเกินกำหนดหรือตรวจสอบไม่สำเร็จ",
        detail: {
          check: "backup_overdue",
          status: backupHealth.status,
          message: backupHealth.message,
          latestBackupAt: backupHealth.latestBackupAt?.toISOString() ?? null,
        },
        actorId: null,
        actorName: "",
      });
    }
  } catch {
    // ตรวจ backup ไม่สำเร็จให้ข้ามเงียบๆ ไม่ให้ scan หลักพัง
  }

  // dependency_vuln — best effort เท่านั้น runner ล้มเหลวให้ข้ามเงียบๆ
  let auditSummary: NpmAuditSummary | null = null;
  try {
    auditSummary = await (input.npmAuditRunner ?? defaultNpmAuditRunner)();
  } catch {
    auditSummary = null;
  }
  if (
    auditSummary &&
    (auditSummary.critical > 0 ||
      auditSummary.high > 0 ||
      auditSummary.moderate > 0)
  ) {
    const critical = auditSummary.critical > 0 || auditSummary.high > 0;
    drafts.push({
      category: "vulnerability",
      severity: critical ? "critical" : "warning",
      rule: "dependency_vuln",
      title: `พบช่องโหว่ dependency จาก npm audit (critical ${auditSummary.critical}, high ${auditSummary.high}, moderate ${auditSummary.moderate})`,
      detail: { check: "npm_audit", ...auditSummary },
      actorId: null,
      actorName: "",
    });
  }

  // กัน event ซ้ำกับรายการที่ยังเปิด (status=new) ภายในหน้าต่างสแกนเดียวกัน
  const existingNew = await db
    .select({
      rule: securityEvents.rule,
      actorId: securityEvents.actorId,
      actorName: securityEvents.actorName,
      detail: securityEvents.detail,
    })
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.branchId, input.branchId),
        eq(securityEvents.status, "new"),
        gte(securityEvents.createdAt, since)
      )
    );
  const seen = new Set(
    existingNew.map(row => `${row.rule}|${dedupeKeyFor(row)}`)
  );

  let created = 0;
  const byRule: Record<string, number> = {};
  for (const draft of drafts) {
    const key = `${draft.rule}|${dedupeKeyFor(draft)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(securityEvents).values({
      branchId: input.branchId,
      category: draft.category,
      severity: draft.severity,
      rule: draft.rule,
      title: draft.title,
      detail: draft.detail,
      actorId: draft.actorId,
      actorName: draft.actorName,
    });
    created += 1;
    byRule[draft.rule] = (byRule[draft.rule] ?? 0) + 1;
  }

  // เก็บ login_attempts ไว้แค่ช่วงสั้นพอตรวจ brute force แล้วลบทิ้ง
  await db
    .delete(loginAttempts)
    .where(
      lt(
        loginAttempts.createdAt,
        new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * 24 * 3_600_000)
      )
    );

  return {
    scanned: loginRows.length + auditRows.length,
    created,
    byRule,
  };
}

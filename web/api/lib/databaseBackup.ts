import { createHash } from "crypto";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import {
  Storage,
  type FileMetadata,
  type StorageOptions,
} from "@google-cloud/storage";
import { env } from "./env";

const BACKUP_SCHEMA = "pos";
const BACKUP_FORMAT_VERSION = 1;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export type BackupTrigger = "manual" | "scheduled";

export type DatabaseBackup = {
  objectName: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
  sha256: string;
  trigger: BackupTrigger | "monthly";
};

export type DatabaseBackupDeletion = {
  objectName: string;
  fileName: string;
  manifestDeleted: boolean;
  warning: string;
};

export class BackupNotConfiguredError extends Error {}
export class BackupInProgressError extends Error {}

let storageClient: Storage | undefined;
let backupInFlight: Promise<DatabaseBackup> | undefined;

function requiredBackupBucket(): string {
  if (!env.gcsBackupBucket) {
    throw new BackupNotConfiguredError(
      "ยังไม่ได้ตั้งค่า Private GCS สำหรับสำรองฐานข้อมูล"
    );
  }
  return env.gcsBackupBucket;
}

function storageOptions(): StorageOptions {
  if (!env.gcsBackupCredentialsBase64) {
    return env.gcsBackupProjectId ? { projectId: env.gcsBackupProjectId } : {};
  }

  try {
    const credentials = JSON.parse(
      Buffer.from(env.gcsBackupCredentialsBase64, "base64").toString("utf8")
    ) as { client_email?: string; private_key?: string; project_id?: string };
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("credentials fields are incomplete");
    }
    return {
      projectId: env.gcsBackupProjectId || credentials.project_id,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    };
  } catch {
    throw new BackupNotConfiguredError(
      "GCS_BACKUP_CREDENTIALS_BASE64 ไม่ใช่ service-account JSON ที่ถูกต้อง"
    );
  }
}

function getStorage(): Storage {
  storageClient ??= new Storage(storageOptions());
  return storageClient;
}

function safeCommandError(command: string, output: string): Error {
  const sanitized = output
    .replaceAll(env.databaseUrl, "[DATABASE_URL]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL]")
    .trim();
  return new Error(
    sanitized
      ? `${command} ทำงานไม่สำเร็จ: ${sanitized}`
      : `${command} ทำงานไม่สำเร็จ`
  );
}

function postgresEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
    return {
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE:
        decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
      PGSSLMODE: url.searchParams.get("sslmode") || "require",
      PGCONNECT_TIMEOUT: "30",
      PGAPPNAME: "pumpos-logical-backup",
    };
  } catch {
    throw new Error("DATABASE_URL สำหรับสำรองข้อมูลมีรูปแบบไม่ถูกต้อง");
  }
}

async function runCommand(
  command: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_COMMAND_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", error =>
      reject(safeCommandError(command, error.message))
    );
    child.once("close", code => {
      if (code === 0) resolve(output.trim());
      else reject(safeCommandError(command, output));
    });
  });
}

async function sha256Of(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function timestampForName(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function pathFor(trigger: BackupTrigger, date: Date): string {
  const stamp = timestampForName(date);
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${trigger}/${yyyy}/${mm}/${dd}/kimi-agent-pos-${BACKUP_SCHEMA}-${stamp}.dump`;
}

function thailandDateParts(date: Date): {
  year: string;
  month: string;
  day: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

async function maybeCreateMonthlyCopy(
  sourceObjectName: string,
  manifestObjectName: string,
  createdAt: Date
): Promise<void> {
  const { year, month, day } = thailandDateParts(createdAt);
  if (day !== "01") return;

  const bucket = getStorage().bucket(requiredBackupBucket());
  const monthlyPrefix = `monthly/${year}-${month}/`;
  const [existing] = await bucket.getFiles({
    prefix: monthlyPrefix,
    maxResults: 1,
    autoPaginate: false,
  });
  if (existing.length > 0) return;

  const monthlyObjectName = `${monthlyPrefix}${basename(sourceObjectName)}`;
  await bucket.file(sourceObjectName).copy(bucket.file(monthlyObjectName));
  await bucket
    .file(manifestObjectName)
    .copy(bucket.file(`${monthlyObjectName}.json`));
}

async function performBackup(trigger: BackupTrigger): Promise<DatabaseBackup> {
  const bucketName = requiredBackupBucket();
  const createdAt = new Date();
  const objectName = pathFor(trigger, createdAt);
  const workDir = await mkdtemp(join(tmpdir(), "pumpos-backup-"));
  const dumpPath = join(workDir, basename(objectName));
  const manifestPath = `${dumpPath}.json`;

  try {
    const pgEnvironment = postgresEnvironment(env.databaseUrl);
    const pgDumpVersion = await runCommand(env.pgDumpPath, ["--version"]);
    await runCommand(
      env.pgDumpPath,
      [
        "--format=custom",
        "--compress=9",
        `--schema=${BACKUP_SCHEMA}`,
        "--no-owner",
        "--no-privileges",
        "--no-subscriptions",
        `--file=${dumpPath}`,
      ],
      pgEnvironment
    );

    await runCommand(env.pgRestorePath, ["--list", dumpPath]);
    const fileStat = await stat(dumpPath);
    if (fileStat.size <= 0) throw new Error("ไฟล์สำรองฐานข้อมูลว่างเปล่า");
    const sha256 = await sha256Of(dumpPath);
    const manifest = {
      version: BACKUP_FORMAT_VERSION,
      application: "Kimi-Agent-POS",
      projectRef: env.supabaseProjectRef,
      schema: BACKUP_SCHEMA,
      format: "PostgreSQL custom archive",
      createdAt: createdAt.toISOString(),
      trigger,
      sizeBytes: fileStat.size,
      sha256,
      pgDumpVersion,
      restoreCommand:
        "pg_restore --single-transaction --no-owner --no-privileges --dbname=<TARGET_DATABASE_URL> <BACKUP_FILE>",
    };
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const bucket = getStorage().bucket(bucketName);
    const commonMetadata = {
      cacheControl: "no-store, max-age=0",
      metadata: {
        application: "Kimi-Agent-POS",
        projectRef: env.supabaseProjectRef,
        schema: BACKUP_SCHEMA,
        sha256,
        trigger,
        createdAt: createdAt.toISOString(),
      },
    };
    await bucket.upload(dumpPath, {
      destination: objectName,
      resumable: fileStat.size >= 5 * 1024 * 1024,
      validation: "crc32c",
      metadata: {
        ...commonMetadata,
        contentType: "application/octet-stream",
        contentDisposition: `attachment; filename="${basename(objectName)}"`,
      },
    });
    const manifestObjectName = `${objectName}.json`;
    await bucket.upload(manifestPath, {
      destination: manifestObjectName,
      resumable: false,
      validation: "crc32c",
      metadata: {
        ...commonMetadata,
        contentType: "application/json; charset=utf-8",
      },
    });
    if (trigger === "scheduled") {
      await maybeCreateMonthlyCopy(objectName, manifestObjectName, createdAt);
    }

    return {
      objectName,
      fileName: basename(objectName),
      sizeBytes: fileStat.size,
      createdAt,
      sha256,
      trigger,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function backupIsConfigured(): boolean {
  return Boolean(env.gcsBackupBucket);
}

export function backupDeleteIsEnabled(): boolean {
  return backupIsConfigured() && env.gcsBackupDeleteEnabled;
}

export async function createDatabaseBackup(
  trigger: BackupTrigger
): Promise<DatabaseBackup> {
  if (backupInFlight)
    throw new BackupInProgressError("กำลังสำรองฐานข้อมูลอยู่แล้ว");
  backupInFlight = performBackup(trigger);
  try {
    return await backupInFlight;
  } finally {
    backupInFlight = undefined;
  }
}

export function isSafeBackupObjectName(objectName: string): boolean {
  return (
    /^(manual|scheduled|monthly)\/[A-Za-z0-9_./-]+\.dump$/.test(objectName) &&
    !objectName.includes("..")
  );
}

export function validateManualBackupDeletion(
  objectName: string,
  confirmation: string
): string {
  if (!isSafeBackupObjectName(objectName)) {
    throw new Error("ชื่อไฟล์สำรองไม่ถูกต้อง");
  }
  if (!objectName.startsWith("manual/")) {
    throw new Error(
      "ลบผ่านแอปได้เฉพาะไฟล์ที่สั่งสำรองเองเท่านั้น ไฟล์อัตโนมัติและรายเดือนจะลบตาม Lifecycle"
    );
  }

  const fileName = basename(objectName);
  if (confirmation !== fileName) {
    throw new Error("กรุณาพิมพ์ชื่อไฟล์สำรองให้ตรงทุกตัวอักษรเพื่อยืนยันการลบ");
  }
  return fileName;
}

function gcsErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  const code = Number((error as { code?: unknown }).code);
  return Number.isFinite(code) ? code : undefined;
}

function backupDeleteError(error: unknown): Error {
  const code = gcsErrorCode(error);
  if (code === 403) {
    return new Error(
      "GCS service account ยังไม่มีสิทธิ์ storage.objects.delete สำหรับ bucket สำรอง"
    );
  }
  if (code === 404)
    return new Error("ไม่พบไฟล์สำรองที่เลือก หรือไฟล์ถูกลบไปแล้ว");
  if (code === 412) {
    return new Error(
      "ไฟล์สำรองมีการเปลี่ยนแปลงหลังเปิดหน้าจอ กรุณารีเฟรชรายการแล้วลองใหม่"
    );
  }
  return new Error("ลบไฟล์สำรองจาก Private GCS ไม่สำเร็จ");
}

export async function deleteManualDatabaseBackup(
  objectName: string,
  confirmation: string
): Promise<DatabaseBackupDeletion> {
  const fileName = validateManualBackupDeletion(objectName, confirmation);
  if (!env.gcsBackupDeleteEnabled) {
    throw new Error(
      "ยังไม่เปิดการลบไฟล์สำรองบน production (GCS_BACKUP_DELETE_ENABLED=true)"
    );
  }

  const bucket = getStorage().bucket(requiredBackupBucket());
  const dumpFile = bucket.file(objectName);
  const manifestFile = bucket.file(`${objectName}.json`);

  let dumpMetadata: FileMetadata;
  try {
    [dumpMetadata] = await dumpFile.getMetadata();
  } catch (error) {
    throw backupDeleteError(error);
  }
  if (String(dumpMetadata.metadata?.trigger || "") !== "manual") {
    throw new Error(
      "Metadata ของไฟล์ไม่ใช่ manual backup จึงปฏิเสธการลบเพื่อความปลอดภัย"
    );
  }
  const dumpGeneration = String(dumpMetadata.generation || "");
  if (!dumpGeneration) {
    throw new Error(
      "ไม่พบ generation ของไฟล์สำรอง จึงไม่สามารถลบอย่างปลอดภัยได้"
    );
  }

  let manifestGeneration = "";
  let manifestMetadata: FileMetadata | undefined;
  try {
    [manifestMetadata] = await manifestFile.getMetadata();
  } catch (error) {
    if (gcsErrorCode(error) === 404) {
      manifestMetadata = undefined;
    } else {
      throw backupDeleteError(error);
    }
  }
  if (manifestMetadata) {
    manifestGeneration = String(manifestMetadata.generation || "");
    if (!manifestGeneration) {
      throw new Error(
        "ไม่พบ generation ของ manifest จึงไม่สามารถลบอย่างปลอดภัยได้"
      );
    }
  }

  try {
    await dumpFile.delete({ ifGenerationMatch: dumpGeneration });
  } catch (error) {
    throw backupDeleteError(error);
  }

  let manifestDeleted = false;
  let warning = "";
  if (manifestGeneration) {
    try {
      await manifestFile.delete({ ifGenerationMatch: manifestGeneration });
      manifestDeleted = true;
    } catch (error) {
      console.error(`ลบ manifest ของ ${objectName} ไม่สำเร็จ:`, error);
      warning =
        "ลบไฟล์ dump แล้ว แต่ลบ manifest ไม่สำเร็จ ระบบ Lifecycle จะจัดการไฟล์ manifest ภายหลัง";
    }
  }

  return { objectName, fileName, manifestDeleted, warning };
}

function triggerFromObjectName(objectName: string): DatabaseBackup["trigger"] {
  if (objectName.startsWith("manual/")) return "manual";
  if (objectName.startsWith("monthly/")) return "monthly";
  return "scheduled";
}

export async function listDatabaseBackups(
  limit = 40
): Promise<DatabaseBackup[]> {
  if (!backupIsConfigured()) return [];
  const bucket = getStorage().bucket(requiredBackupBucket());
  const prefixes = ["manual/", "scheduled/", "monthly/"];
  const groups = await Promise.all(
    prefixes.map(async prefix => {
      const [files] = await bucket.getFiles({ prefix });
      return files;
    })
  );

  return groups
    .flat()
    .filter(file => file.name.endsWith(".dump"))
    .map(file => {
      const metadata = file.metadata;
      const createdAt = new Date(
        String(metadata.metadata?.createdAt || metadata.timeCreated || 0)
      );
      return {
        objectName: file.name,
        fileName: basename(file.name),
        sizeBytes: Number(metadata.size || 0),
        createdAt,
        sha256: String(metadata.metadata?.sha256 || ""),
        trigger: triggerFromObjectName(file.name),
      } satisfies DatabaseBackup;
    })
    .filter(backup => Number.isFinite(backup.createdAt.getTime()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export async function createBackupDownloadUrl(
  objectName: string
): Promise<{ url: string; expiresAt: Date }> {
  if (!isSafeBackupObjectName(objectName)) {
    throw new Error("ชื่อไฟล์สำรองไม่ถูกต้อง");
  }
  const file = getStorage().bucket(requiredBackupBucket()).file(objectName);
  const [exists] = await file.exists();
  if (!exists) throw new Error("ไม่พบไฟล์สำรองที่เลือก");

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAt,
    responseDisposition: `attachment; filename="${basename(objectName)}"`,
  });
  return { url, expiresAt };
}

export function resetBackupClientForTests(): void {
  storageClient = undefined;
  backupInFlight = undefined;
}

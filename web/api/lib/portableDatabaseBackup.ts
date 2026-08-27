import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";

const BACKUP_FORMAT = "kimi-agent-pos-database-backup";
const BACKUP_VERSION = 1;
const BACKUP_SCHEMA = "pos";
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

type BackupTableDefinition = {
  name: string;
  orderBy: string;
  identityColumn?: "id";
};

// Insert order follows the foreign-key graph. Keep this list explicit so a
// file can never select from or restore into an arbitrary database object.
const BACKUP_TABLES: readonly BackupTableDefinition[] = [
  { name: "branches", orderBy: "id", identityColumn: "id" },
  {
    name: "staff_access_groups",
    orderBy: "id",
    identityColumn: "id",
  },
  { name: "staff_users", orderBy: "id", identityColumn: "id" },
  { name: "staff_branches", orderBy: "staff_id, branch_id" },
  { name: "work_shift_templates", orderBy: "id", identityColumn: "id" },
  { name: "work_schedules", orderBy: "id", identityColumn: "id" },
  { name: "employee_profiles", orderBy: "id", identityColumn: "id" },
  { name: "payroll_records", orderBy: "id", identityColumn: "id" },
  { name: "products", orderBy: "id", identityColumn: "id" },
  { name: "stock_count_sessions", orderBy: "id", identityColumn: "id" },
  { name: "stock_count_items", orderBy: "id", identityColumn: "id" },
  { name: "pumps", orderBy: "id", identityColumn: "id" },
  { name: "fuel_tanks", orderBy: "id", identityColumn: "id" },
  { name: "nozzles", orderBy: "id", identityColumn: "id" },
  { name: "shifts", orderBy: "id", identityColumn: "id" },
  { name: "shift_readings", orderBy: "id", identityColumn: "id" },
  { name: "members", orderBy: "id", identityColumn: "id" },
  { name: "member_card_batches", orderBy: "id", identityColumn: "id" },
  { name: "member_cards", orderBy: "id", identityColumn: "id" },
  { name: "customers", orderBy: "id", identityColumn: "id" },
  { name: "sales", orderBy: "id", identityColumn: "id" },
  { name: "sale_items", orderBy: "id", identityColumn: "id" },
  { name: "point_transactions", orderBy: "id", identityColumn: "id" },
  { name: "rewards", orderBy: "id", identityColumn: "id" },
  { name: "reward_redemptions", orderBy: "id", identityColumn: "id" },
  { name: "tank_refills", orderBy: "id", identityColumn: "id" },
  { name: "tank_readings", orderBy: "id", identityColumn: "id" },
  { name: "tax_invoices", orderBy: "id", identityColumn: "id" },
  { name: "debt_payments", orderBy: "id", identityColumn: "id" },
  { name: "expenses", orderBy: "id", identityColumn: "id" },
  { name: "price_changes", orderBy: "id", identityColumn: "id" },
  { name: "audit_logs", orderBy: "id", identityColumn: "id" },
  { name: "payment_settings", orderBy: "branch_id" },
  { name: "payment_sessions", orderBy: "id", identityColumn: "id" },
  { name: "settings", orderBy: "branch_id, key" },
  { name: "assistant_settings", orderBy: "branch_id" },
  { name: "assistant_action_proposals", orderBy: "id" },
  { name: "security_events", orderBy: "id" },
  { name: "login_attempts", orderBy: "id", identityColumn: "id" },
  { name: "security_reports", orderBy: "id", identityColumn: "id" },
] as const;

type BackupTableData = {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

type BackupPayload = {
  createdAt: string;
  schema: typeof BACKUP_SCHEMA;
  tables: BackupTableData[];
  totalRows: number;
};

type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  checksum: {
    algorithm: "SHA-256";
    value: string;
  };
  payload: BackupPayload;
};

export type PortableDatabaseBackup = {
  fileName: string;
  mimeType: "application/gzip";
  contentBase64: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  tableCount: number;
  totalRows: number;
};

export type PortableDatabaseRestore = {
  fileName: string;
  createdAt: string;
  sha256: string;
  tableCount: number;
  totalRows: number;
};

function quotedTable(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("ชื่อตารางสำรองข้อมูลไม่ถูกต้อง");
  }
  return `"${BACKUP_SCHEMA}"."${name}"`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("ไฟล์สำรองข้อมูลเข้ารหัส base64 ไม่ถูกต้อง");
  }
  if (binary.length > MAX_COMPRESSED_BYTES) {
    throw new Error("ไฟล์สำรองข้อมูลมีขนาดใหญ่เกิน 32 MB");
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    copiedArrayBuffer(bytes)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([copiedArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([copiedArrayBuffer(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
  } catch {
    throw new Error("ไฟล์สำรองข้อมูลไม่ใช่ไฟล์ .posbackup ที่ถูกต้อง");
  }
  let result: Uint8Array;
  try {
    result = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error("เปิดไฟล์สำรองข้อมูลไม่สำเร็จหรือไฟล์เสียหาย");
  }
  if (result.byteLength > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("ข้อมูลภายในไฟล์สำรองมีขนาดใหญ่เกิน 128 MB");
  }
  return result;
}

function backupFileName(createdAt: Date): string {
  const stamp = createdAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `kimi-agent-pos-${stamp}.posbackup`;
}

function resultRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("อ่านข้อมูลตารางสำหรับสำรองข้อมูลไม่สำเร็จ");
  }
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("รูปแบบแถวข้อมูลสำหรับสำรองข้อมูลไม่ถูกต้อง");
    }
    return row as Record<string, unknown>;
  });
}

async function readTableData(
  table: BackupTableDefinition
): Promise<BackupTableData> {
  const tableName = quotedTable(table.name);
  const query = sql.raw(
    `select coalesce(jsonb_agg(to_jsonb(source) order by ${table.orderBy}), '[]'::jsonb) as rows from ${tableName} as source`
  );
  const rawResult = (await getDb().execute(query)) as unknown;
  const result = Array.isArray(rawResult)
    ? (rawResult as Array<{ rows: unknown }>)
    : isRecord(rawResult) && Array.isArray(rawResult.rows)
      ? (rawResult.rows as Array<{ rows: unknown }>)
      : [];
  const rows = resultRows(result[0]?.rows ?? []);
  return { name: table.name, rowCount: rows.length, rows };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEnvelope(value: unknown): BackupEnvelope {
  if (!isRecord(value)) throw new Error("รูปแบบไฟล์สำรองข้อมูลไม่ถูกต้อง");
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("ไฟล์สำรองข้อมูลคนละชนิดหรือเวอร์ชันนี้ยังไม่รองรับ");
  }
  if (!isRecord(value.checksum) || value.checksum.algorithm !== "SHA-256") {
    throw new Error("ไฟล์สำรองข้อมูลไม่มี checksum ที่รองรับ");
  }
  if (!/^[a-f0-9]{64}$/.test(String(value.checksum.value ?? ""))) {
    throw new Error("checksum ของไฟล์สำรองข้อมูลไม่ถูกต้อง");
  }
  if (!isRecord(value.payload) || value.payload.schema !== BACKUP_SCHEMA) {
    throw new Error("schema ของไฟล์สำรองข้อมูลไม่ถูกต้อง");
  }
  const createdAt = String(value.payload.createdAt ?? "");
  if (!Number.isFinite(new Date(createdAt).getTime())) {
    throw new Error("วันเวลาของไฟล์สำรองข้อมูลไม่ถูกต้อง");
  }
  if (!Array.isArray(value.payload.tables)) {
    throw new Error("ไฟล์สำรองข้อมูลไม่มีรายการตาราง");
  }
  const expectedNames = BACKUP_TABLES.map(table => table.name);
  const actualNames = value.payload.tables.map(table =>
    isRecord(table) ? String(table.name ?? "") : ""
  );
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("ชุดตารางในไฟล์ไม่ตรงกับฐานข้อมูลเวอร์ชันปัจจุบัน");
  }

  let totalRows = 0;
  const tables = value.payload.tables.map(table => {
    if (!isRecord(table) || !Array.isArray(table.rows)) {
      throw new Error("ข้อมูลตารางในไฟล์สำรองไม่ถูกต้อง");
    }
    const rows = resultRows(table.rows);
    if (table.rowCount !== rows.length) {
      throw new Error(`จำนวนแถวของตาราง ${String(table.name)} ไม่ตรงกัน`);
    }
    totalRows += rows.length;
    return {
      name: String(table.name),
      rowCount: rows.length,
      rows,
    };
  });
  if (value.payload.totalRows !== totalRows) {
    throw new Error("จำนวนแถวรวมในไฟล์สำรองข้อมูลไม่ตรงกัน");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    checksum: {
      algorithm: "SHA-256",
      value: String(value.checksum.value),
    },
    payload: {
      createdAt,
      schema: BACKUP_SCHEMA,
      tables,
      totalRows,
    },
  };
}

async function decodeAndVerifyBackup(
  contentBase64: string
): Promise<{ envelope: BackupEnvelope; fileSha256: string }> {
  const compressed = base64ToBytes(contentBase64);
  const fileSha256 = await sha256Hex(compressed);
  const uncompressed = await gunzip(compressed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(uncompressed)
    );
  } catch {
    throw new Error("อ่าน JSON ภายในไฟล์สำรองข้อมูลไม่สำเร็จ");
  }
  const envelope = parseEnvelope(parsed);
  const payloadChecksum = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(envelope.payload))
  );
  if (payloadChecksum !== envelope.checksum.value) {
    throw new Error("checksum ไม่ตรงกัน ไฟล์สำรองอาจเสียหายหรือถูกแก้ไข");
  }
  return { envelope, fileSha256 };
}

export async function createPortableDatabaseBackup(): Promise<PortableDatabaseBackup> {
  const created = new Date();
  const tables: BackupTableData[] = [];
  for (const table of BACKUP_TABLES) tables.push(await readTableData(table));
  const payload: BackupPayload = {
    createdAt: created.toISOString(),
    schema: BACKUP_SCHEMA,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
  };
  const checksum = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    checksum: { algorithm: "SHA-256", value: checksum },
    payload,
  };
  const compressed = await gzip(
    new TextEncoder().encode(JSON.stringify(envelope))
  );
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error(
      "ไฟล์สำรองหลังบีบอัดมีขนาดเกิน 32 MB กรุณาใช้ pg_dump จากเครื่องผู้ดูแลแทน"
    );
  }
  return {
    fileName: backupFileName(created),
    mimeType: "application/gzip",
    contentBase64: bytesToBase64(compressed),
    createdAt: payload.createdAt,
    sizeBytes: compressed.byteLength,
    sha256: await sha256Hex(compressed),
    tableCount: tables.length,
    totalRows: payload.totalRows,
  };
}

export async function restorePortableDatabaseBackup(input: {
  fileName: string;
  contentBase64: string;
}): Promise<PortableDatabaseRestore> {
  if (!input.fileName.toLowerCase().endsWith(".posbackup")) {
    throw new Error("กรุณาเลือกไฟล์นามสกุล .posbackup");
  }
  const { envelope, fileSha256 } = await decodeAndVerifyBackup(
    input.contentBase64
  );
  const tablesByName = new Map(
    envelope.payload.tables.map(table => [table.name, table] as const)
  );
  const truncateTargets = BACKUP_TABLES.map(table =>
    quotedTable(table.name)
  ).join(", ");

  await getDb().transaction(async tx => {
    await tx.execute(
      sql.raw(`truncate table ${truncateTargets} restart identity cascade`)
    );
    for (const table of BACKUP_TABLES) {
      const data = tablesByName.get(table.name);
      if (!data?.rows.length) continue;
      const tableName = quotedTable(table.name);
      await tx.execute(sql`
        insert into ${sql.raw(tableName)}
        select * from jsonb_populate_recordset(
          null::${sql.raw(tableName)},
          ${JSON.stringify(data.rows)}::jsonb
        )
      `);
    }
    for (const table of BACKUP_TABLES) {
      if (!table.identityColumn) continue;
      const tableName = quotedTable(table.name);
      await tx.execute(
        sql.raw(
          `select setval(pg_get_serial_sequence('${BACKUP_SCHEMA}.${table.name}', 'id'), coalesce((select max(id) from ${tableName}), 1), exists(select 1 from ${tableName}))`
        )
      );
    }
  });

  return {
    fileName: input.fileName,
    createdAt: envelope.payload.createdAt,
    sha256: fileSha256,
    tableCount: envelope.payload.tables.length,
    totalRows: envelope.payload.totalRows,
  };
}

export const portableBackupTableNames = BACKUP_TABLES.map(table => table.name);

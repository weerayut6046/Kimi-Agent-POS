import fs from "fs";
import path from "path";
import { format } from "date-fns";
import { inArray } from "drizzle-orm";
import { settings } from "@db/schema";
import { getDb } from "../queries/connection";
import { backupsDir, makeBackup } from "./backup";

const AUTO_PREFIX = "pos-auto";
const DEFAULT_TIME = "23:30";
const DEFAULT_KEEP = 7;

/** วันที่ (local) ที่รันสำรองอัตโนมัติล่าสุดใน process นี้ — กันรันซ้ำวันเดียวกัน */
let lastRunDate = "";

/** อ่านค่าตั้งสำรองอัตโนมัติจาก db สดๆ ทุกครั้ง (แก้จากหน้าตั้งค่าแล้วมีผลทันที ไม่ต้องรีสตาร์ท) */
async function readAutoBackupConfig() {
  const rows = await getDb()
    .select()
    .from(settings)
    .where(inArray(settings.key, ["backup_auto_enabled", "backup_auto_time", "backup_auto_keep"]));
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const timeRaw = map.backup_auto_time ?? "";
  const keepRaw = parseInt(map.backup_auto_keep ?? "", 10);
  return {
    enabled: map.backup_auto_enabled === "1",
    time: /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw : DEFAULT_TIME,
    keep: Number.isFinite(keepRaw) ? Math.max(1, keepRaw) : DEFAULT_KEEP,
  };
}

/** ลบไฟล์สำรองอัตโนมัติ (pos-auto-*) ที่เก่าสุดเกินจำนวน keep — ห้ามแตะไฟล์ prefix อื่น (pos-backup-/pos-pre-restore-/pos-upload-) */
function pruneAutoBackups(keep: number) {
  const dir = backupsDir();
  // ชื่อไฟล์มี timestamp yyyyMMdd-HHmmss ความกว้างคงที่ → เรียงตัวอักษร = เรียงเวลา
  const autoFiles = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${AUTO_PREFIX}-`) && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const f of autoFiles.slice(keep)) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

/**
 * สำรองอัตโนมัติถ้าถึงเวลา: เปิดใช้งาน + เวลา local ของ now ถึง/เลยเวลาที่ตั้ง + วันนี้ยังไม่ได้รัน
 * (เช็กทั้งตัวแปรใน process และไฟล์ pos-auto ของวันนี้ เผื่อเพิ่งรีสตาร์ทแอปวันเดียวกัน)
 * คืน true ถ้าได้สำรองจริง — error ถูก log แล้วกลืนไว้ ไม่ให้ process พัง
 */
export async function runAutoBackupIfDue(now = new Date()): Promise<boolean> {
  try {
    const cfg = await readAutoBackupConfig();
    if (!cfg.enabled) return false;

    const [h, m] = cfg.time.split(":").map(Number);
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;

    const todayKey = format(now, "yyyy-MM-dd");
    if (lastRunDate === todayKey) return false;
    // เคสรีสตาร์ทแอปวันเดียวกัน: ตัวแปรหาย แต่ไฟล์ของวันนี้มีอยู่แล้ว → ถือว่ารันไปแล้ว
    const ranFile = fs
      .readdirSync(backupsDir())
      .some((f) => f.startsWith(`${AUTO_PREFIX}-${format(now, "yyyyMMdd")}-`) && f.endsWith(".db"));
    if (ranFile) {
      lastRunDate = todayKey;
      return false;
    }

    const full = await makeBackup(AUTO_PREFIX, now);
    lastRunDate = todayKey;
    pruneAutoBackups(cfg.keep);
    console.log(`[autobackup] สำรองข้อมูลอัตโนมัติแล้ว: ${path.basename(full)}`);
    return true;
  } catch (e) {
    console.error("[autobackup] สำรองข้อมูลอัตโนมัติล้มเหลว:", e);
    return false;
  }
}

/** เริ่มตัวจับเวลาสำรองอัตโนมัติ (เช็กทุก 1 นาที) — unref ไว้ไม่ให้ interval ค้าง process ตอน test/build */
export function startAutoBackupScheduler(): void {
  const timer = setInterval(() => void runAutoBackupIfDue(), 60_000);
  timer.unref();
  // เช็กทันทีตอนสตาร์ท เผื่อเปิดแอปหลังเวลาที่ตั้งไว้แต่ยังเป็นวันเดียวกัน (เงื่อนไขเวลาเป็นแบบ "ถึง/เลย" อยู่แล้ว)
  void runAutoBackupIfDue();
  console.log("[autobackup] เริ่มตัวจับเวลาสำรองข้อมูลอัตโนมัติ (เช็กทุก 1 นาที)");
}

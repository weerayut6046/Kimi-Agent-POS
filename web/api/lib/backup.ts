import fs from "fs";
import path from "path";
import { format } from "date-fns";
import { getDb, getDbPath } from "../queries/connection";

/** โฟลเดอร์เก็บไฟล์สำรอง (อยู่ข้างไฟล์ฐานข้อมูล) — สร้างให้ถ้ายังไม่มี */
export function backupsDir(): string {
  const dir = path.join(path.dirname(getDbPath()), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** สำรองฐานข้อมูลปัจจุบันลงโฟลเดอร์ backups (online-safe ด้วย better-sqlite3 backup API) คืน path เต็มของไฟล์ที่สร้าง */
export async function makeBackup(prefix: string, now = new Date()): Promise<string> {
  const name = `${prefix}-${format(now, "yyyyMMdd-HHmmss")}.db`;
  const dest = path.join(backupsDir(), name);
  await getDb().$client.backup(dest);
  return dest;
}

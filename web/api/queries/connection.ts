import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>> | undefined;

/** path สุทธิของไฟล์ฐานข้อมูลที่ใช้อยู่ */
export function getDbPath() {
  return path.resolve(env.databaseUrl);
}

export function getDb() {
  if (!instance) {
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    instance = drizzle(sqlite, { schema: fullSchema });
  }
  return instance;
}

/** ปิด connection และล้าง singleton (ใช้ตอน restore ฐานข้อมูล — connection จะถูกเปิดใหม่ที่ request ถัดไป) */
export function resetDb() {
  if (instance) {
    try {
      instance.$client.close();
    } catch {
      // ปิดไม่สำเร็จก็ไม่เป็นไร — process กำลังจะใช้ไฟล์ใหม่ต่อ
    }
    instance = undefined;
  }
}

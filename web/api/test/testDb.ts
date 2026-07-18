import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * ตั้งฐานข้อมูล SQLite ชั่วคราวสำหรับ integration test (ไฟล์ละฐานข้อมูลหนึ่งก้อน)
 * ต้องตั้ง DATABASE_URL ก่อน import โมดูลฝั่ง API — env.ts อ่านค่าตอนโหลดโมดูล
 * และ connection.ts เก็บ singleton จึง dynamic import หลังตั้ง env เสมอ
 */
export async function setupTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-test-"));
  process.env.DATABASE_URL = path.join(dir, "test.db");

  const { getDb, resetDb } = await import("../queries/connection");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { seedIfEmpty } = await import("../../db/seedCore");
  const { appRouter } = await import("../router");

  const db = getDb();
  migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)),
  });
  await seedIfEmpty();

  /** สร้าง tRPC caller พร้อม header บทบาท (guard อ่าน x-staff-role) — ส่ง staffId เพิ่มได้สำหรับ actor ใน audit */
  const caller = (role?: "admin" | "manager" | "cashier", staffId?: number) =>
    appRouter.createCaller({
      req: new Request("http://test.local/api", {
        headers: {
          ...(role ? { "x-staff-role": role } : {}),
          ...(staffId ? { "x-staff-id": String(staffId) } : {}),
        },
      }),
      resHeaders: new Headers(),
    });

  const cleanup = () => {
    resetDb();
    fs.rmSync(dir, { recursive: true, force: true });
  };

  return { db, caller, cleanup };
}

export type TestDb = Awaited<ReturnType<typeof setupTestDb>>;
